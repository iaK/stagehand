import { useCallback, useRef } from "react";
import { useProjectStore } from "../stores/projectStore";
import { useTaskStore } from "../stores/taskStore";
import { useProcessStore, stageKey } from "../stores/processStore";
import { useGitHubStore } from "../stores/githubStore";
import { spawnClaude, killProcess, listProcessesDetailed } from "../lib/claude";
import { renderPrompt } from "../lib/prompt";
import {
  hasUncommittedChanges,
  gitDiffStat,
  isGitRepo,
  gitBranchExists,
  gitPush,
  gitDefaultBranch,
  ghCreatePr,
  gitWorktreeAdd,
  gitWorktreeRemove,
  gitDeleteBranch,
} from "../lib/git";
import { getTaskWorkingDir } from "../lib/worktree";
import * as repo from "../lib/repositories";
import { sendNotification } from "../lib/notifications";
import type {
  Task,
  StageTemplate,
  StageExecution,
  GateRule,
  ClaudeStreamEvent,
} from "../lib/types";

/** Stage names whose output may produce git changes eligible for committing. */
export const COMMIT_ELIGIBLE_STAGES = ["Implementation", "Refinement", "Security Review"] as const;

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

      // Create worktree on first stage execution if task has no worktree yet
      if (stage.output_format === "research" && !task.worktree_path) {
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

      // Clear task_stages when re-running Research so user re-selects stages
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

        // Use the previous stage's composed result as input context
        const previousOutput =
          prevExec?.stage_result ??
          prevExec?.parsed_output ??
          prevExec?.raw_output ??
          undefined;

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

        // Fetch approved stage summaries for {{stage_summaries}}
        const summaries = await repo.getApprovedStageSummaries(
          activeProject.id,
          task.id,
        );
        const stageSummariesText = summaries.length > 0
          ? summaries
              .map((s) => `### ${s.stage_name}\n${s.stage_summary}`)
              .join("\n\n")
          : undefined;

        // Render prompt
        const prompt = renderPrompt(stage.prompt_template, {
          taskDescription: task.title,
          previousOutput,
          userInput: effectiveUserInput,
          userDecision: prevExec?.user_decision ?? undefined,
          priorAttemptOutput,
          stageSummaries: stageSummariesText,
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
          user_input:
            userInput ??
            (stage.input_source === "previous_stage"
              ? (previousOutput ?? null)
              : null),
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

        // For commit-eligible stages, instruct the agent not to commit —
        // the app handles committing after the user reviews changes.
        let systemPrompt = stage.persona_system_prompt ?? undefined;
        if (COMMIT_ELIGIBLE_STAGES.includes(stage.name as typeof COMMIT_ELIGIBLE_STAGES[number])) {
          const noCommitRule =
            "IMPORTANT: Do NOT run git add, git commit, or any git commands that stage or commit changes. The user will review and commit changes separately after this stage completes.";
          systemPrompt = systemPrompt
            ? `${systemPrompt}\n\n${noCommitRule}`
            : noCommitRule;
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
            jsonSchema:
              stage.output_format !== "text" &&
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
          } catch {
            // Execution may not have been created yet — ignore
          }
        }
        if (useTaskStore.getState().activeTask?.id === task.id) {
          await loadExecutions(activeProject.id, task.id).catch(() => {});
        } else {
          await useTaskStore.getState().refreshTaskExecStatuses(activeProject.id).catch(() => {});
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
        if (stage.output_format !== "text" && !isFindingsApply) {
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

        // Generate pending commit for commit-eligible stages
        if (COMMIT_ELIGIBLE_STAGES.includes(stage.name as typeof COMMIT_ELIGIBLE_STAGES[number])) {
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

      // Get the previous stage's result (for append/passthrough)
      const prevExec = await repo.getPreviousStageExecution(
        activeProject.id,
        task.id,
        stage.sort_order,
        taskStageTemplates,
      );
      const prevResult = prevExec?.stage_result ?? null;

      // Extract this stage's own contribution
      const ownOutput = extractStageOutput(stage, latest, decision);

      // Compose stage_result based on result_mode
      const resultMode = stage.result_mode ?? "replace";
      let stageResult: string;
      switch (resultMode) {
        case "append":
          stageResult = prevResult
            ? `${prevResult}\n\n---\n\n${ownOutput}`
            : ownOutput;
          break;
        case "passthrough":
          stageResult = prevResult ?? ownOutput;
          break;
        case "replace":
        default:
          stageResult = ownOutput;
          break;
      }

      // Extract a concise summary for this stage
      const stageSummary = extractStageSummary(stage, latest, decision);

      // PR Preparation: create the PR before marking as approved so failures
      // are surfaced to the user and the stage can be retried.
      // The completion strategy was already baked into the task's stage
      // selection at Research-approval time, so if this task has a PR
      // Preparation stage we always create the PR — regardless of the
      // current project-level setting (which may have changed since).
      if (stage.name === "PR Preparation" && task.branch_name) {
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
              console.error("Auto-start next stage failed:", err);
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
      } catch {
        // Backend may be unreachable
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
    setTimeout(async () => {
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

  return { runStage, approveStage, redoStage, killCurrent };
}

/** Generate a pending commit for a commit-eligible stage that just finished. */
export async function generatePendingCommit(
  task: Task,
  stage: StageTemplate,
  projectPath: string,
  _projectId: string,
): Promise<void> {
  const workDir = getTaskWorkingDir(task, projectPath);
  const store = useProcessStore.getState();

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
    const prefix = stage.name === "Implementation" ? "feat" : "fix";
    const commitMsg = `${prefix}: ${slug}`;

    store.setPendingCommit({
      stageId: stage.id,
      stageName: stage.name,
      message: commitMsg,
      diffStat: diffStat || "",
    });
  } finally {
    store.setCommitMessageLoading(null);
  }
}

/** Try to find and validate a JSON object in a string. Searches raw stdout lines too. */
export function extractJson(text: string): string | null {
  if (!text) return null;

  // First try: parse the whole thing
  try {
    JSON.parse(text);
    return text;
  } catch {
    // continue
  }

  // Second try: find JSON in stream-json result lines
  // With --json-schema, output is in structured_output; otherwise in result
  for (const line of text.split("\n")) {
    try {
      const event = JSON.parse(line);
      if (event.type === "result") {
        const output = event.structured_output ?? event.result;
        if (output != null && output !== "") {
          const str =
            typeof output === "string" ? output : JSON.stringify(output);
          const parsed = JSON.parse(str);
          if (typeof parsed === "object" && parsed !== null) {
            return str;
          }
        }
      }
    } catch {
      // continue
    }
  }

  // Third try: find a JSON object in the text
  // Use greedy match first (handles nested objects), fall back to lazy (handles multiple separate objects)
  const greedyMatch = text.match(/\{[\s\S]*\}/);
  if (greedyMatch) {
    try {
      JSON.parse(greedyMatch[0]);
      return greedyMatch[0];
    } catch {
      // Greedy match failed (likely grabbed across multiple separate JSON objects) — try lazy
      const lazyMatch = text.match(/\{[\s\S]*?\}/);
      if (lazyMatch) {
        try {
          JSON.parse(lazyMatch[0]);
          return lazyMatch[0];
        } catch {
          // continue
        }
      }
    }
  }

  return null;
}

/** Extract a clean, human-readable output from a stage for its stage_result. */
export function extractStageOutput(
  stage: StageTemplate,
  execution: StageExecution,
  decision?: string,
): string {
  const raw = execution.parsed_output ?? execution.raw_output ?? "";

  switch (stage.output_format) {
    case "research": {
      // Extract the markdown research text from the JSON envelope
      try {
        const data = JSON.parse(raw);
        if (data.research) return data.research;
      } catch {
        // fall through
      }
      return raw;
    }
    case "plan": {
      // Extract the plan text from the JSON envelope
      try {
        const data = JSON.parse(raw);
        if (data.plan) return data.plan;
      } catch {
        // fall through
      }
      return raw;
    }
    case "options": {
      // The stage's value is the user's selection, not the full options list
      if (decision) return formatSelectedApproach(decision);
      return raw;
    }
    case "findings": {
      // Phase 1 (skip all): extract summary from JSON
      // Phase 2 (applied fixes): raw text output
      try {
        const data = JSON.parse(raw);
        if (data.summary) return data.summary;
      } catch {
        // Parse failed — this is phase 2 text output
      }
      return raw;
    }
    case "pr_review":
      return raw || "PR Review completed";
    case "merge":
      return raw || "Branch merged successfully";
    default:
      return raw;
  }
}

export function formatSelectedApproach(decision: string): string {
  try {
    const selected = JSON.parse(decision);
    if (!Array.isArray(selected) || selected.length === 0) return decision;
    const approach = selected[0];
    let text = `## Selected Approach: ${approach.title}\n\n${approach.description}`;
    if (approach.pros?.length) {
      text += `\n\n**Pros:**\n${approach.pros.map((p: string) => `- ${p}`).join("\n")}`;
    }
    if (approach.cons?.length) {
      text += `\n\n**Cons:**\n${approach.cons.map((c: string) => `- ${c}`).join("\n")}`;
    }
    return text;
  } catch {
    return decision;
  }
}

/** Extract a concise summary from a stage's output for use in PR preparation. */
export function extractStageSummary(
  stage: StageTemplate,
  execution: StageExecution,
  decision?: string,
): string | null {
  const raw = execution.parsed_output ?? execution.raw_output ?? "";
  if (!raw.trim()) return null;

  switch (stage.output_format) {
    case "research": {
      try {
        const data = JSON.parse(raw);
        if (data.research) return truncateToSentences(data.research, 3);
      } catch { /* fall through */ }
      return truncateToSentences(raw, 3);
    }
    case "plan": {
      try {
        const data = JSON.parse(raw);
        if (data.plan) return truncateToSentences(data.plan, 3);
      } catch { /* fall through */ }
      return truncateToSentences(raw, 3);
    }
    case "options": {
      if (decision) {
        try {
          const selected = JSON.parse(decision);
          if (Array.isArray(selected) && selected.length > 0) {
            const approach = selected[0];
            return `Selected: ${approach.title} — ${truncateToSentences(approach.description, 2)}`;
          }
        } catch { /* fall through */ }
      }
      return truncateToSentences(raw, 3);
    }
    case "findings": {
      try {
        const data = JSON.parse(raw);
        if (data.summary) return data.summary;
      } catch {
        // Phase 2 text output — summarize
      }
      return truncateToSentences(raw, 3);
    }
    case "pr_review":
      return raw ? truncateToSentences(raw, 3) : null;
    case "merge":
      return raw ? truncateToSentences(raw, 3) : null;
    case "text": {
      return extractImplementationSummary(raw);
    }
    default:
      return truncateToSentences(raw, 3);
  }
}

/** Extract first N sentences from text. */
export function truncateToSentences(text: string, n: number): string {
  // Strip markdown headers for cleaner extraction
  const cleaned = text.replace(/^#+\s+.*$/gm, "").trim();
  // Match sentences ending with . ! or ?
  const sentences = cleaned.match(/[^.!?]*[.!?]+/g);
  if (!sentences || sentences.length === 0) {
    // No clear sentences — take first ~300 chars
    return cleaned.slice(0, 300).trim();
  }
  return sentences.slice(0, n).join("").trim();
}

/** Extract summary from implementation (text format) output. */
export function extractImplementationSummary(raw: string): string | null {
  if (!raw.trim()) return null;

  // Look for explicit summary sections near end of output
  const summaryMatch = raw.match(
    /(?:^|\n)#+\s*(?:Summary|Changes Made|What (?:was|I) (?:changed|did))[^\n]*\n([\s\S]{10,500}?)(?:\n#|\n---|\n\*\*|$)/i,
  );
  if (summaryMatch) {
    return truncateToSentences(summaryMatch[1].trim(), 3);
  }

  // Fall back to last paragraph (implementation output often ends with a summary)
  const paragraphs = raw.split(/\n\n+/).filter((p) => p.trim().length > 20);
  if (paragraphs.length > 0) {
    const last = paragraphs[paragraphs.length - 1].trim();
    return truncateToSentences(last, 3);
  }

  return truncateToSentences(raw, 3);
}

export function validateGate(
  rule: GateRule,
  decision: string | undefined,
  _execution: StageExecution,
): boolean {
  switch (rule.type) {
    case "require_approval":
      return true;
    case "require_selection": {
      if (!decision) return false;
      try {
        const selected = JSON.parse(decision);
        if (!Array.isArray(selected)) return false;
        return (
          selected.length >= rule.min && selected.length <= rule.max
        );
      } catch {
        return true; // Treat non-array as single selection
      }
    }
    case "require_all_checked": {
      if (!decision) return false;
      try {
        const items = JSON.parse(decision);
        return (
          Array.isArray(items) && items.every((item: { checked: boolean }) => item.checked)
        );
      } catch {
        return false;
      }
    }
    case "require_fields": {
      if (!decision) return false;
      try {
        const fields = JSON.parse(decision);
        return rule.fields.every(
          (f) => fields[f] && String(fields[f]).trim().length > 0,
        );
      } catch {
        return false;
      }
    }
    default:
      return true;
  }
}

/** Determine whether a stage should be auto-started after the previous stage completes. */
export function shouldAutoStartStage(stage: StageTemplate): boolean {
  if (stage.output_format === "merge") return false;
  return stage.input_source !== "user" && stage.input_source !== "both";
}
