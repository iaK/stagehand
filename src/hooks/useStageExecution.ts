import { useCallback } from "react";
import { useProjectStore } from "../stores/projectStore";
import { useTaskStore } from "../stores/taskStore";
import { useProcessStore, stageKey } from "../stores/processStore";
import { spawnClaude, killProcess } from "../lib/claude";
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

            await updateTask(activeProject.id, task.id, {
              branch_name: branchName,
              worktree_path: worktreePath,
            });
            // Update local task reference
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
            priorAttemptOutput = userInput;
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
          started_at: new Date().toISOString(),
        };

        await repo.createStageExecution(activeProject.id, execution);
        await updateTask(activeProject.id, task.id, { status: "in_progress" });

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
              loadExecutions(activeProject!.id, taskId);
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
              );
              break;
            case "error":
              setStopped(sk);
              appendOutput(sk, `[Error] ${event.message}`);
              repo.updateStageExecution(activeProject!.id, executionId!, {
                status: "failed",
                error_message: event.message,
                completed_at: new Date().toISOString(),
              }).then(() => loadExecutions(activeProject!.id, taskId));
              break;
          }
        };

        // For commit-eligible stages, instruct the agent not to commit —
        // the app handles committing after the user reviews changes.
        const commitEligibleStages = ["Implementation", "Refinement", "Security Review"];
        let systemPrompt = stage.persona_system_prompt ?? undefined;
        if (commitEligibleStages.includes(stage.name)) {
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
              !(stage.output_format === "findings" && attemptNumber > 1)
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
        await loadExecutions(activeProject.id, task.id).catch(() => {});
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
      attemptNumber?: number,
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
        });
        if (!wasKilled) {
          sendNotification("Stage failed", `${stage.name} encountered an error`, "error");
        }
      } else {
        // Try to parse structured output
        let parsedOutput = resultText;
        const isFindingsPhase2 = stage.output_format === "findings" && (attemptNumber ?? 1) > 1;
        if (stage.output_format !== "text" && !isFindingsPhase2) {
          parsedOutput = extractJson(resultText) ?? extractJson(rawOutput) ?? resultText;
        }

        await repo.updateStageExecution(activeProject.id, executionId, {
          status: "awaiting_user",
          raw_output: rawOutput,
          parsed_output: parsedOutput,
          thinking_output: savedThinking,
          completed_at: new Date().toISOString(),
        });
        sendNotification("Stage complete", `${stage.name} needs your review`, "success");
      }

      await loadExecutions(activeProject.id, taskId);
    },
    [activeProject, loadExecutions],
  );

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

      // For commit-eligible stages, generate pending commit and wait for user decision
      // (advanceFromStage will be called after the user commits or skips)
      const commitEligibleStages = ["Implementation", "Refinement", "Security Review"];
      if (commitEligibleStages.includes(stage.name)) {
        await generatePendingCommit(task, stage);
        await loadExecutions(activeProject.id, task.id);
        return;
      }

      // Non-commit stages: advance immediately
      await advanceFromStageInner(activeProject.id, task, stage, taskStageTemplates);
    },
    [activeProject, stageTemplates, updateTask, loadExecutions],
  );

  const generatePendingCommit = useCallback(
    async (task: Task, stage: StageTemplate) => {
      if (!activeProject) return;

      const workDir = getTaskWorkingDir(task, activeProject.path);

      const gitRepo = await isGitRepo(activeProject.path);
      if (!gitRepo) {
        // Not a git repo — skip commit, advance directly
        const taskStageTemplates = useTaskStore.getState().getActiveTaskStageTemplates();
        await advanceFromStageInner(activeProject.id, task, stage, taskStageTemplates);
        return;
      }

      const hasChanges = await hasUncommittedChanges(workDir);
      if (!hasChanges) {
        // No changes to commit — advance directly
        const taskStageTemplates = useTaskStore.getState().getActiveTaskStageTemplates();
        await advanceFromStageInner(activeProject.id, task, stage, taskStageTemplates);
        return;
      }

      const diffStat = await gitDiffStat(workDir).catch(() => "");

      // Generate commit message using Claude (lightweight one-shot)
      let commitMessage = `${stage.name.toLowerCase()}: ${task.title}`;
      try {
        const commitRules = await repo.getProjectSetting(
          activeProject.id,
          "github_commit_rules",
        );

        const prompt = `Generate a concise git commit message for the following changes.

Task: ${task.title}
Stage: ${stage.name}

Changes (git diff --stat):
${diffStat}

${commitRules ? `Repository commit conventions:\n${commitRules}\n\n` : ""}
Return ONLY the commit message text, nothing else. No quotes, no markdown, no explanation.
Keep it under 72 characters for the first line. Add a blank line and body if needed.`;

        let resultText = "";
        await new Promise<void>((resolve) => {
          spawnClaude(
            {
              prompt,
              workingDirectory: workDir,
              maxTurns: 1,
              allowedTools: [],
              outputFormat: "text",
              noSessionPersistence: true,
            },
            (event: ClaudeStreamEvent) => {
              if (event.type === "stdout_line") {
                resultText += event.line + "\n";
              } else if (event.type === "completed" || event.type === "error") {
                resolve();
              }
            },
          ).catch(() => resolve());
        });

        const cleaned = resultText.trim();
        if (cleaned.length > 0) {
          commitMessage = cleaned;
        }
      } catch {
        // Use fallback message
      }

      // Set pending commit — StageView will show the approval dialog
      useProcessStore.getState().setPendingCommit({
        stageId: stage.id,
        stageName: stage.name,
        message: commitMessage,
        diffStat,
      });
      sendNotification("Ready to commit", `${stage.name} has changes to commit`, "success");
    },
    [activeProject],
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
      const baseBranch = await gitDefaultBranch(activeProject.path) ?? undefined;

      // Create the PR
      const prUrl = await ghCreatePr(workDir, title, body, baseBranch);

      // Save PR URL to the task
      if (prUrl) {
        await updateTask(activeProject.id, task.id, { pr_url: prUrl.trim() });
        sendNotification("PR created", title, "success");
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
      } else {
        await updateTask(projectId, task.id, {
          status: "completed",
        });
        // Clean up worktree on completion
        if (task.worktree_path) {
          try {
            const project = useProjectStore.getState().activeProject;
            if (project) {
              await gitWorktreeRemove(project.path, task.worktree_path);
            }
          } catch {
            // Non-critical — worktree cleanup is best-effort
          }
        }
      }

      await loadExecutions(projectId, task.id);
    },
    [updateTask, loadExecutions],
  );

  const advanceFromStage = useCallback(
    async (task: Task, stage: StageTemplate) => {
      if (!activeProject) return;
      const taskStageTemplates = useTaskStore.getState().getActiveTaskStageTemplates();
      await advanceFromStageInner(activeProject.id, task, stage, taskStageTemplates);
    },
    [activeProject, advanceFromStageInner],
  );

  const redoStage = useCallback(
    async (task: Task, stage: StageTemplate, feedback?: string) => {
      if (!activeProject) return;
      await runStage(task, stage, feedback);
    },
    [activeProject, runStage],
  );

  const killCurrent = useCallback(async (taskId: string, stageId: string) => {
    const sk = stageKey(taskId, stageId);
    const state = useProcessStore.getState().stages[sk];
    if (!state?.isRunning) return;

    // Mark as killed before sending the signal so finalizeExecution knows
    useProcessStore.getState().markKilled(sk);

    const processId = state.processId;
    const isPlaceholder = !processId || processId === "spawning" || processId === "fixing";

    if (isPlaceholder) {
      // Process not yet registered with the backend.
      // Stop the stage immediately so the UI transitions to the failed/retry state.
      // The "started" event handler will kill the real process when it arrives.
      useProcessStore.getState().setStopped(sk);

      const project = useProjectStore.getState().activeProject;
      if (project) {
        const exec = useTaskStore.getState().executions.find(
          (e) => e.task_id === taskId && e.stage_template_id === stageId && e.status === "running",
        );
        if (exec) {
          await repo.updateStageExecution(project.id, exec.id, {
            status: "failed",
            error_message: "Stopped by user",
            completed_at: new Date().toISOString(),
          });
          await useTaskStore.getState().loadExecutions(project.id, taskId);
        }
      }
      return;
    }

    try {
      await killProcess(processId);
    } catch {
      // Process may have already exited
    }
  }, []);

  return { runStage, approveStage, advanceFromStage, redoStage, killCurrent };
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
