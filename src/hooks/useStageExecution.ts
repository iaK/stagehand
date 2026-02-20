import { useCallback, useEffect, useRef } from "react";
import { useProjectStore } from "../stores/projectStore";
import { useTaskStore } from "../stores/taskStore";
import { useProcessStore, stageKey } from "../stores/processStore";
import { useGitHubStore } from "../stores/githubStore";
import { invoke } from "@tauri-apps/api/core";
import { spawnClaude, killProcess, listProcessesDetailed } from "../lib/claude";
import { renderPrompt } from "../lib/prompt";
import {
  hasUncommittedChanges,
  gitDiffStat,
  isGitRepo,
  gitBranchExists,
  gitPush,
  gitDefaultBranch,
  gitCheckoutBranch,
  ghCreatePr,
  gitWorktreeAdd,
  gitWorktreeRemove,
  gitDeleteBranch,
} from "../lib/git";
import { getTaskWorkingDir } from "../lib/worktree";
import * as repo from "../lib/repositories";
import { sendNotification } from "../lib/notifications";
import { logger } from "../lib/logger";
import {
  extractJson,
  extractStageOutput,
  extractStageSummary,
  validateGate,
  shouldAutoStartStage,
} from "../lib/stageUtils";
import type {
  Task,
  StageTemplate,
  StageExecution,
  GateRule,
  ClaudeStreamEvent,
} from "../lib/types";

export function useStageExecution() {
  const activeProject = useProjectStore((s) => s.activeProject);
  const stageTemplates = useTaskStore((s) => s.stageTemplates);
  const executions = useTaskStore((s) => s.executions);
  const loadExecutions = useTaskStore((s) => s.loadExecutions);
  const updateTask = useTaskStore((s) => s.updateTask);
  const appendOutput = useProcessStore((s) => s.appendOutput);
  const clearOutput = useProcessStore((s) => s.clearOutput);
  const setRunning = useProcessStore((s) => s.setRunning);
  const setStopped = useProcessStore((s) => s.setStopped);

  const runStage = useCallback(
    async (task: Task, stage: StageTemplate, userInput?: string) => {
      if (!activeProject) return;

      if (task.ejected) {
        logger.info("Cannot run stage while task is ejected to main repo");
        return;
      }

      // Create worktree on first stage execution if task has no worktree yet
      if (stage.sort_order === 0 && !task.worktree_path) {
        try {
          const gitRepo = await isGitRepo(activeProject.path);
          if (gitRepo) {
            // Use existing branch name or generate one
            let branchName = task.branch_name;
            if (!branchName) {
              // Simple slug generation from task title
              const slug = task.title
                .toLowerCase()
                .replace(/^\[[\w-]+\]\s*/, "") // remove [ENG-123] prefix
                .replace(/[^a-z0-9]+/g, "-")
                .replace(/^-|-$/g, "")
                .slice(0, 50);
              branchName = `feature/${slug}`;
            }

            const worktreePath = `${activeProject.path}/.stagehand-worktrees/${branchName.replace(/\//g, "--")}`;

            const exists = await gitBranchExists(activeProject.path, branchName);

            // Clean up stale worktree if directory already exists
            try {
              await gitWorktreeRemove(activeProject.path, worktreePath);
            } catch {
              // Worktree may not exist — that's fine
            }

            await gitWorktreeAdd(activeProject.path, worktreePath, branchName, !exists);

            // Update local task reference — defer the DB/store update to
            // batch with the status: "in_progress" write below so we only
            // trigger one listTasks reload instead of two.
            task = { ...task, branch_name: branchName, worktree_path: worktreePath };
          }
        } catch (err) {
          // Worktree creation is non-critical — continue with stage execution in project root
          const errMsg = err instanceof Error ? err.message : String(err);
          appendOutput(stageKey(task.id, stage.id), `[Warning] Worktree creation failed, running in project root: ${errMsg}`);
        }
      }

      // Clear task_stages when re-running the research stage (triggers stage selection)
      if (stage.output_format === "research") {
        const prevAttemptCheck = executions.filter((e) => e.stage_template_id === stage.id);
        if (prevAttemptCheck.length > 0) {
          await repo.setTaskStages(activeProject.id, task.id, []);
          await useTaskStore.getState().loadTaskStages(activeProject.id, task.id);
        }
      }

      const sk = stageKey(task.id, stage.id);
      clearOutput(sk);
      setRunning(sk, "spawning");

      let executionId: string | null = null;
      try {
        // Find previous completed execution (using filtered stage list from store)
        const taskStageTemplates = useTaskStore.getState().getActiveTaskStageTemplates();
        const prevExec = await repo.getPreviousStageExecution(
          activeProject.id,
          task.id,
          stage.sort_order,
          taskStageTemplates,
        );

        // Count previous attempts and gather prior context for re-runs
        const prevAttempts = executions
          .filter((e) => e.stage_template_id === stage.id)
          .sort((a, b) => a.attempt_number - b.attempt_number);
        const attemptNumber = prevAttempts.length + 1;

        // For re-runs: include prior attempt output so the agent knows what
        // it already researched/asked, and preserve the original user input
        let priorAttemptOutput: string | undefined;
        let effectiveUserInput = userInput;
        if (prevAttempts.length > 0) {
          const latestAttempt = prevAttempts[prevAttempts.length - 1];
          priorAttemptOutput =
            latestAttempt.parsed_output ?? latestAttempt.raw_output ?? undefined;

          if (stage.output_format === "findings") {
            // For findings redo: userInput contains the selected findings text.
            // Route it into priorAttemptOutput so {{#if prior_attempt_output}} activates
            // with the selected items, and clear effectiveUserInput.
            // If userInput is empty (e.g. "Redo with Feedback" with no text),
            // leave priorAttemptOutput undefined so the Phase 1 review template
            // activates with the json_schema.
            if (userInput) {
              priorAttemptOutput = userInput;
            } else {
              priorAttemptOutput = undefined;
            }
            effectiveUserInput = undefined;
          } else {
            // Preserve original user input from the first attempt
            const firstAttempt = prevAttempts[0];
            if (firstAttempt.user_input && userInput) {
              effectiveUserInput = `${firstAttempt.user_input}\n\n---\n\nAnswers to follow-up questions:\n${userInput}`;
            } else if (firstAttempt.user_input && !userInput) {
              // Retry without new input — re-use original input
              effectiveUserInput = firstAttempt.user_input;
            }
          }
        }

        // Fetch approved stage outputs for system prompt injection
        const approvedOutputs = await repo.getApprovedStageOutputs(
          activeProject.id,
          task.id,
        );

        // Build {{available_stages}} — list of non-first stages for Research prompt
        const availableStagesText = taskStageTemplates
          .filter((t) => t.sort_order > 0)
          .map((t) => `- "${t.name}": ${t.description}`)
          .join("\n");

        // Render prompt
        const prompt = renderPrompt(stage.prompt_template, {
          taskDescription: task.title,
          userInput: effectiveUserInput,
          userDecision: prevExec?.user_decision ?? undefined,
          priorAttemptOutput,
          availableStages: availableStagesText || undefined,
        });

        // Always use a fresh session — context is passed via the prompt template
        const sessionId = crypto.randomUUID();

        // Create execution record
        executionId = crypto.randomUUID();
        const execution: Omit<StageExecution, "completed_at"> = {
          id: executionId,
          task_id: task.id,
          stage_template_id: stage.id,
          attempt_number: attemptNumber,
          status: "running",
          input_prompt: prompt,
          user_input: userInput ?? null,
          raw_output: null,
          parsed_output: null,
          user_decision: null,
          session_id: sessionId,
          error_message: null,
          thinking_output: null,
          stage_result: null,
          stage_summary: null,
          input_tokens: null,
          output_tokens: null,
          cache_creation_input_tokens: null,
          cache_read_input_tokens: null,
          total_cost_usd: null,
          duration_ms: null,
          num_turns: null,
          started_at: new Date().toISOString(),
        };

        await repo.createStageExecution(activeProject.id, execution);
        // Batch worktree fields (if set during this run) with the status
        // update so we only trigger a single listTasks reload.
        await updateTask(activeProject.id, task.id, {
          status: "in_progress",
          ...(task.branch_name ? { branch_name: task.branch_name } : {}),
          ...(task.worktree_path ? { worktree_path: task.worktree_path } : {}),
        });

        // Add the new execution to the store immediately so that killCurrent
        // and the health check can find it even before spawnClaude fires events,
        // without triggering a full loadExecutions reload (which involves IPC
        // calls and creates new object references that cascade re-renders).
        {
          const currentExecs = useTaskStore.getState().executions;
          const fullExecution = { ...execution, completed_at: null } as StageExecution;
          useTaskStore.setState({ executions: [...currentExecs, fullExecution] });
        }

        // Build allowed tools
        let allowedTools: string[] | undefined;
        if (stage.allowed_tools) {
          try {
            allowedTools = JSON.parse(stage.allowed_tools);
          } catch {
            // ignore
          }
        }

        // Collect output
        let rawOutput = "";
        let resultText = "";
        let thinkingText = "";
        let usageData: {
          input_tokens?: number;
          output_tokens?: number;
          cache_creation_input_tokens?: number;
          cache_read_input_tokens?: number;
          total_cost_usd?: number;
          duration_ms?: number;
          num_turns?: number;
        } | null = null;

        // Capture task.id so completion handler uses the correct task even if activeTask changes
        const taskId = task.id;

        const onEvent = (event: ClaudeStreamEvent) => {
          switch (event.type) {
            case "started":
              // If kill was requested while spawning, kill immediately and don't re-enable
              if (useProcessStore.getState().stages[sk]?.killed) {
                killProcess(event.process_id).catch(() => {});
                break;
              }
              setRunning(sk, event.process_id);
              appendOutput(sk, `[Process started: ${event.process_id}]`);
              // Refresh executions so the UI transitions to show the live stream
              if (useTaskStore.getState().activeTask?.id === taskId) {
                loadExecutions(activeProject!.id, taskId);
              } else {
                useTaskStore.getState().refreshTaskExecStatuses(activeProject!.id);
              }
              break;
            case "stdout_line":
              rawOutput += event.line + "\n";
              // Try to parse stream-json events
              try {
                const parsed = JSON.parse(event.line);
                if (parsed.type === "assistant" && parsed.message?.content) {
                  for (const block of parsed.message.content) {
                    if (block.type === "text") {
                      appendOutput(sk, block.text);
                      resultText += block.text;
                      thinkingText += block.text;
                    }
                  }
                } else if (parsed.type === "result") {
                  // With --json-schema, the output is in structured_output, not result
                  const output = parsed.structured_output ?? parsed.result;
                  if (output != null && output !== "") {
                    const text =
                      typeof output === "string"
                        ? output
                        : JSON.stringify(output);
                    resultText = text;
                    appendOutput(sk, text);
                  }
                  // Capture usage data from result event
                  if (parsed.usage) {
                    usageData = {
                      input_tokens: parsed.usage.input_tokens,
                      output_tokens: parsed.usage.output_tokens,
                      cache_creation_input_tokens: parsed.usage.cache_creation_input_tokens,
                      cache_read_input_tokens: parsed.usage.cache_read_input_tokens,
                      total_cost_usd: parsed.total_cost_usd,
                      duration_ms: parsed.duration_ms,
                      num_turns: parsed.num_turns,
                    };
                  }
                  // Don't add result to thinkingText — it's the final structured output
                } else if (parsed.type === "content_block_delta") {
                  if (parsed.delta?.text) {
                    appendOutput(sk, parsed.delta.text);
                    resultText += parsed.delta.text;
                    thinkingText += parsed.delta.text;
                  }
                }
              } catch {
                // Not JSON, just append as-is
                appendOutput(sk, event.line);
              }
              break;
            case "stderr_line":
              appendOutput(sk, `[stderr] ${event.line}`);
              break;
            case "completed":
              setStopped(sk);
              appendOutput(
                sk,
                `[Process completed with exit code: ${event.exit_code}]`,
              );
              // Update execution in DB
              finalizeExecution(
                executionId!,
                taskId,
                stage,
                rawOutput,
                resultText,
                event.exit_code,
                thinkingText,
                attemptNumber,
                usageData,
                !!priorAttemptOutput,
              );
              break;
            case "error":
              setStopped(sk);
              appendOutput(sk, `[Error] ${event.message}`);
              repo.updateStageExecution(activeProject!.id, executionId!, {
                status: "failed",
                error_message: event.message,
                completed_at: new Date().toISOString(),
              }).then(() => {
                if (useTaskStore.getState().activeTask?.id === taskId) {
                  loadExecutions(activeProject!.id, taskId);
                } else {
                  useTaskStore.getState().refreshTaskExecStatuses(activeProject!.id);
                }
              });
              break;
          }
        };

        // Always instruct the agent not to commit — the app handles
        // committing after the user reviews changes (harmless for read-only stages).
        let systemPrompt = stage.persona_system_prompt ?? undefined;
        {
          const noCommitRule =
            "IMPORTANT: Do NOT run git add, git commit, or any git commands that stage or commit changes. The user will review and commit changes separately after this stage completes.";
          systemPrompt = systemPrompt
            ? `${systemPrompt}\n\n${noCommitRule}`
            : noCommitRule;
        }

        // Auto-inject completed stage summaries into system prompt
        if (approvedOutputs.length > 0) {
          const stageLines = approvedOutputs
            .map((s) => `### ${s.stage_name}\n${s.stage_summary || "(no summary)"}`)
            .join("\n\n");
          const stageContext =
            `## Completed Pipeline Stages\nThe following stages have been completed for this task. Use the \`get_stage_output\` MCP tool to retrieve the full output of any stage if you need more detail.\n\n${stageLines}`;
          systemPrompt = systemPrompt
            ? `${systemPrompt}\n\n${stageContext}`
            : stageContext;
        }

        // Build MCP config for stage context server
        let mcpConfig: string | undefined;
        try {
          const mcpServerPath = await invoke<string>("get_mcp_server_path");
          const devflowDir = await invoke<string>("get_devflow_dir");
          const dbPath = `${devflowDir}/data/${activeProject.id}.db`;
          const config = {
            mcpServers: {
              "stagehand-context": {
                command: "node",
                args: [mcpServerPath],
                env: {
                  STAGEHAND_DB_PATH: dbPath,
                  STAGEHAND_TASK_ID: task.id,
                },
              },
            },
          };
          mcpConfig = JSON.stringify(config);

          // Append MCP tool hint to system prompt
          const mcpHint =
            "You have access to `list_completed_stages`, `get_stage_output`, and `get_task_description` tools to retrieve data from prior pipeline stages on demand.";
          systemPrompt = systemPrompt
            ? `${systemPrompt}\n\n${mcpHint}`
            : mcpHint;
        } catch (err) {
          // Graceful degradation — MCP server unavailable, prompt context still works
          logger.warn("MCP server config failed, continuing without MCP:", err);
        }

        await spawnClaude(
          {
            prompt,
            workingDirectory: getTaskWorkingDir(task, activeProject.path),
            sessionId,
            stageExecutionId: executionId,
            appendSystemPrompt: systemPrompt,
            outputFormat: "stream-json",
            allowedTools: allowedTools,
            mcpConfig,
            jsonSchema:
              stage.output_schema &&
              !(stage.output_format === "findings" && !!priorAttemptOutput)
                ? stage.output_schema
                : undefined,
          },
          onEvent,
        );
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        setStopped(sk);
        appendOutput(sk, `[Failed] ${errorMsg}`);
        // Update the execution record with the actual error (if it was created)
        if (executionId) {
          try {
            await repo.updateStageExecution(activeProject.id, executionId, {
              status: "failed",
              error_message: errorMsg,
              completed_at: new Date().toISOString(),
            });
          } catch (err) {
            logger.error("Failed to record stage failure status", err);
          }
        }
        if (useTaskStore.getState().activeTask?.id === task.id) {
          await loadExecutions(activeProject.id, task.id).catch((err) => logger.error("Failed to reload executions after stage failure", err));
        } else {
          await useTaskStore.getState().refreshTaskExecStatuses(activeProject.id).catch((err) => logger.error("Failed to refresh task statuses", err));
        }
      }
    },
    [
      activeProject,
      stageTemplates,
      executions,
      clearOutput,
      appendOutput,
      setRunning,
      setStopped,
      updateTask,
      loadExecutions,
    ],
  );

  const finalizeExecution = useCallback(
    async (
      executionId: string,
      taskId: string,
      stage: StageTemplate,
      rawOutput: string,
      resultText: string,
      exitCode: number | null,
      thinkingText?: string,
      _attemptNumber?: number,
      usageData?: {
        input_tokens?: number;
        output_tokens?: number;
        cache_creation_input_tokens?: number;
        cache_read_input_tokens?: number;
        total_cost_usd?: number;
        duration_ms?: number;
        num_turns?: number;
      } | null,
      isFindingsApply?: boolean,
    ) => {
      if (!activeProject) return;

      const sk = stageKey(taskId, stage.id);
      const wasKilled = useProcessStore.getState().stages[sk]?.killed ?? false;

      const savedThinking = thinkingText?.trim() || null;

      if (wasKilled || (exitCode !== 0 && exitCode !== null)) {
        await repo.updateStageExecution(activeProject.id, executionId, {
          status: "failed",
          raw_output: rawOutput,
          parsed_output: resultText,
          thinking_output: savedThinking,
          error_message: wasKilled ? "Stopped by user" : `Process exited with code ${exitCode}`,
          completed_at: new Date().toISOString(),
          ...(usageData ?? {}),
        });
        if (!wasKilled) {
          sendNotification("Stage failed", `${stage.name} encountered an error`, "error", { projectId: activeProject.id, taskId });
        }
      } else {
        // Try to parse structured output
        let parsedOutput = resultText;
        if (stage.output_schema && !isFindingsApply) {
          parsedOutput = extractJson(resultText) ?? extractJson(rawOutput) ?? resultText;
        }

        await repo.updateStageExecution(activeProject.id, executionId, {
          status: "awaiting_user",
          raw_output: rawOutput,
          parsed_output: parsedOutput,
          thinking_output: savedThinking,
          completed_at: new Date().toISOString(),
          ...(usageData ?? {}),
        });
        sendNotification("Stage complete", `${stage.name} needs your review`, "success", { projectId: activeProject.id, taskId });

        // Always attempt to generate a pending commit (returns early if no changes)
        {
          const task = useTaskStore.getState().activeTask;
          const project = useProjectStore.getState().activeProject;
          if (task && task.id === taskId && project) {
            generatePendingCommit(task, stage, project.path, project.id).catch(() => {});
          }
        }
      }

      // Update detailed executions only if this task is still active — prevents state bleeding
      if (useTaskStore.getState().activeTask?.id === taskId) {
        await loadExecutions(activeProject.id, taskId);
      } else {
        // Always refresh sidebar dot colors so they update even for non-active tasks
        await useTaskStore.getState().refreshTaskExecStatuses(activeProject.id);
      }
    },
    [activeProject, loadExecutions],
  );

  const runStageRef = useRef(runStage);
  runStageRef.current = runStage;

  const killTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const approveStage = useCallback(
    async (task: Task, stage: StageTemplate, decision?: string) => {
      if (!activeProject) return;

      // Find latest execution for this stage
      const latest = await repo.getLatestExecution(
        activeProject.id,
        task.id,
        stage.id,
      );
      if (!latest) return;

      // Validate gate rules
      const gateRule: GateRule = JSON.parse(stage.gate_rules);
      if (!validateGate(gateRule, decision, latest)) {
        return;
      }

      // Use filtered stage templates from store (avoids redundant DB call)
      const taskStageTemplates = useTaskStore.getState().getActiveTaskStageTemplates();

      // Extract this stage's own contribution
      const ownOutput = extractStageOutput(stage, latest, decision);

      // Always "replace" — result_mode is no longer configurable
      const stageResult = ownOutput;

      // Extract a concise summary for this stage
      const stageSummary = extractStageSummary(stage, latest, decision);

      // PR Preparation: create the PR before marking as approved so failures
      // are surfaced to the user and the stage can be retried.
      if (stage.output_format === "pr_preparation" && task.branch_name) {
        await createPullRequest(task, decision);
      }

      // Update execution with decision and computed stage_result
      await repo.updateStageExecution(activeProject.id, latest.id, {
        status: "approved",
        user_decision: decision ?? null,
        stage_result: stageResult,
        stage_summary: stageSummary,
      });

      await advanceFromStageInner(activeProject.id, task, stage, taskStageTemplates);
    },
    [activeProject, stageTemplates, updateTask, loadExecutions],
  );

  const createPullRequest = useCallback(
    async (task: Task, decision?: string) => {
      if (!activeProject || !task.branch_name) return;

      // Parse the PR fields from the user decision
      let title = task.title;
      let body = "";
      if (decision) {
        try {
          const fields = JSON.parse(decision);
          if (fields.title) title = fields.title;
          const parts: string[] = [];
          if (fields.description) parts.push(fields.description);
          if (fields.test_plan) parts.push(`## Test Plan\n\n${fields.test_plan}`);
          body = parts.join("\n\n");
        } catch {
          // Use defaults
        }
      }

      const workDir = getTaskWorkingDir(task, activeProject.path);

      // Push the branch to remote
      await gitPush(workDir, task.branch_name);

      // Determine base branch
      const baseBranch = useGitHubStore.getState().defaultBranch ?? await gitDefaultBranch(activeProject.path) ?? undefined;

      // Create the PR
      const prUrl = await ghCreatePr(workDir, title, body, baseBranch);

      // Save PR URL to the task
      if (prUrl) {
        await updateTask(activeProject.id, task.id, { pr_url: prUrl.trim() });
        sendNotification("PR created", title, "success", { projectId: activeProject.id, taskId: task.id });
      }
    },
    [activeProject, updateTask],
  );

  const advanceFromStageInner = useCallback(
    async (projectId: string, task: Task, stage: StageTemplate, taskStageTemplates: StageTemplate[]) => {
      // Split tasks are terminal — don't advance to the next stage.
      // Query the DB directly instead of reading activeTask from the store,
      // because the user may have navigated to a different task.
      const freshTask = await repo.getTask(projectId, task.id);
      if (freshTask?.status === "split") {
        if (useTaskStore.getState().activeTask?.id === task.id) {
          await loadExecutions(projectId, task.id);
        }
        return;
      }

      const nextStage = taskStageTemplates
        .filter((s) => s.sort_order > stage.sort_order)
        .sort((a, b) => a.sort_order - b.sort_order)[0] ?? null;

      if (nextStage) {
        await updateTask(projectId, task.id, {
          current_stage_id: nextStage.id,
        });

        // Auto-start next stage if it doesn't require user input
        if (shouldAutoStartStage(nextStage)) {
          const freshTask = useTaskStore.getState().activeTask;
          if (freshTask && freshTask.id === task.id) {
            // Fire-and-forget: don't await so the approval flow completes
            // immediately and the UI can update to show the running state.
            // Return early — runStage's "started" event handler will call
            // loadExecutions, avoiding a race with the loadExecutions below.
            runStageRef.current(freshTask, nextStage).catch((err) => {
              logger.error("Auto-start next stage failed:", err);
            });
            return;
          }
        }
      } else {
        // No more stages — task is complete
        await updateTask(projectId, task.id, {
          status: "completed",
        });

        // Clean up worktree on completion. Note: merge stages handle their
        // own completion and cleanup in MergeStageView and never reach here.
        if (task.worktree_path) {
          const project = useProjectStore.getState().activeProject;
          if (project) {
            try {
              await gitWorktreeRemove(project.path, task.worktree_path);
            } catch {
              // Non-critical — worktree cleanup is best-effort
            }
            if (task.branch_name) {
              try {
                await gitDeleteBranch(project.path, task.branch_name);
              } catch {
                // Non-critical — branch cleanup is best-effort
              }
            }
          }
        } else if (task.ejected && task.branch_name) {
          // Defensive: handle ejected case (shouldn't normally reach here
          // since stages are blocked while ejected)
          const project = useProjectStore.getState().activeProject;
          if (project) {
            try {
              const defaultBranch = await gitDefaultBranch(project.path);
              await gitCheckoutBranch(project.path, defaultBranch ?? "main");
            } catch {
              // Non-critical
            }
            try {
              await gitDeleteBranch(project.path, task.branch_name);
            } catch {
              // Non-critical
            }
          }
        }
      }

      // Update detailed executions if active, otherwise just refresh sidebar statuses
      if (useTaskStore.getState().activeTask?.id === task.id) {
        await loadExecutions(projectId, task.id);
      } else {
        await useTaskStore.getState().refreshTaskExecStatuses(projectId);
      }
    },
    [updateTask, loadExecutions],
  );

  const redoStage = useCallback(
    async (task: Task, stage: StageTemplate, feedback?: string) => {
      if (!activeProject) return;
      await runStage(task, stage, feedback);
    },
    [activeProject, runStage],
  );

  /** Mark all "running" executions for this stage as failed (queries DB directly). */
  const failStaleExecutions = useCallback(async (projectId: string, taskId: string, stageId: string) => {
    const execs = await repo.listStageExecutions(projectId, taskId);
    for (const exec of execs) {
      if (exec.stage_template_id === stageId && exec.status === "running") {
        await repo.updateStageExecution(projectId, exec.id, {
          status: "failed",
          error_message: "Stopped by user",
          completed_at: new Date().toISOString(),
        });
      }
    }
    await useTaskStore.getState().loadExecutions(projectId, taskId);
  }, []);

  const killCurrent = useCallback(async (taskId: string, stageId: string) => {
    const sk = stageKey(taskId, stageId);
    const state = useProcessStore.getState().stages[sk];

    if (!state?.isRunning) {
      // No running process in the store — but there may be a stale "running"
      // execution in the DB (e.g. process crashed without cleanup, app restarted).
      // Try to find and kill any backend process, then mark as failed.
      const project = useProjectStore.getState().activeProject;
      if (!project) return;

      const exec = useTaskStore.getState().executions.find(
        (e) => e.task_id === taskId && e.stage_template_id === stageId && e.status === "running",
      );
      if (!exec) return;

      // Try to find and kill the backend process for this execution
      try {
        const detailed = await listProcessesDetailed();
        const match = detailed.find((p) => p.stageExecutionId === exec.id);
        if (match) {
          await killProcess(match.processId);
        }
      } catch (err) {
        logger.error("Failed during kill flow", err);
      }

      // Mark the DB execution as failed
      await repo.updateStageExecution(project.id, exec.id, {
        status: "failed",
        error_message: "Stopped by user",
        completed_at: new Date().toISOString(),
      });
      useProcessStore.getState().setStopped(sk);
      await useTaskStore.getState().loadExecutions(project.id, taskId);
      return;
    }

    // === processStore has running state ===
    useProcessStore.getState().markKilled(sk);

    const processId = state.processId;
    const isPlaceholder = !processId || processId === "spawning" || processId === "fixing";

    if (isPlaceholder) {
      useProcessStore.getState().setStopped(sk);
      const project = useProjectStore.getState().activeProject;
      if (project) {
        // Query DB directly — the execution may not be in the store yet
        await failStaleExecutions(project.id, taskId, stageId);
      }
      return;
    }

    try {
      await killProcess(processId);
    } catch {
      // Process may have already exited
    }

    // Fallback: if the process doesn't send a "completed" event within 3s,
    // force cleanup so the user isn't stuck forever.
    killTimeoutRef.current = setTimeout(async () => {
      const currentState = useProcessStore.getState().stages[sk];
      if (currentState?.isRunning && currentState?.killed) {
        useProcessStore.getState().setStopped(sk);
        const project = useProjectStore.getState().activeProject;
        if (project) {
          await failStaleExecutions(project.id, taskId, stageId);
        }
      }
    }, 3000);
  }, [failStaleExecutions]);

  // Cleanup kill timeout on unmount
  useEffect(() => {
    return () => {
      if (killTimeoutRef.current) {
        clearTimeout(killTimeoutRef.current);
      }
    };
  }, []);

  return { runStage, approveStage, redoStage, killCurrent };
}

/** Generate a pending commit for a stage that just finished. Returns early if no changes. */
export async function generatePendingCommit(
  task: Task,
  stage: StageTemplate,
  projectPath: string,
  projectId: string,
): Promise<void> {
  const workDir = getTaskWorkingDir(task, projectPath);
  const store = useProcessStore.getState();

  // Clear stale state before re-checking
  if (store.pendingCommit?.stageId === stage.id) {
    store.clearPendingCommit();
  }
  if (store.noChangesStageId === stage.id) {
    store.setNoChangesToCommit(null);
  }

  store.setCommitMessageLoading(stage.id);
  try {
    const hasChanges = await hasUncommittedChanges(workDir);
    if (!hasChanges) {
      // No file changes — nothing to commit, mark as no-changes so UI can show approve button
      store.setNoChangesToCommit(stage.id);
      return;
    }

    const diffStat = await gitDiffStat(workDir).catch(() => "");
    const slug = task.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
    const prefix = await repo.getCommitPrefix(projectId).catch(() => "feat");
    const commitMsg = `${prefix}: ${slug}`;

    store.setPendingCommit({
      stageId: stage.id,
      taskId: task.id,
      stageName: stage.name,
      message: commitMsg,
      diffStat: diffStat || "",
    });
  } catch (err) {
    // If commit preparation fails, fall back to no-changes mode
    // so the user can still approve the stage instead of being stuck
    logger.error("Failed to generate pending commit:", err);
    store.setNoChangesToCommit(stage.id);
  } finally {
    store.setCommitMessageLoading(null);
  }
}

// Re-export pure utilities for consumers that import from this file
export {
  extractJson,
  extractStageOutput,
  formatSelectedApproach,
  extractStageSummary,
  truncateToSentences,
  extractImplementationSummary,
  validateGate,
  shouldAutoStartStage,
} from "../lib/stageUtils";
