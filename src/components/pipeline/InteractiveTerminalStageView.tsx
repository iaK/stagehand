import { useState, useRef, useCallback, useEffect } from "react";
import { useProjectStore } from "../../stores/projectStore";
import { useTaskStore } from "../../stores/taskStore";
import { useProcessStore } from "../../stores/processStore";
import { spawnPty, writeToPty, resizePty, killPty, spawnClaude } from "../../lib/claude";
import { getTaskWorkingDir } from "../../lib/worktree";
import { generatePendingCommit } from "../../hooks/useStageExecution";
import * as repo from "../../lib/repositories";
import { invoke } from "@tauri-apps/api/core";
import { sendNotification } from "../../lib/notifications";
import { logger } from "../../lib/logger";
import { XTerminal, type XTerminalHandle } from "./XTerminal";
import { CommitWorkflow } from "./CommitWorkflow";
import { gitAdd, gitCommit } from "../../lib/git";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Loader2 } from "lucide-react";
import type { StageTemplate, PtyEvent, ClaudeStreamEvent } from "../../lib/types";

/**
 * InteractiveTerminalStageView — self-contained stage component (same pattern
 * as MergeStageView). Spawns a real Claude interactive session via PTY and
 * renders it in an xterm.js terminal. Bypasses useStageExecution.
 */
interface Props {
  stage: StageTemplate;
}

type SessionState =
  | "idle"
  | "starting"
  | "running"
  | "finishing"
  | "awaiting_commit"
  | "completed";

export function InteractiveTerminalStageView({ stage }: Props) {
  const activeProject = useProjectStore((s) => s.activeProject);
  const activeTask = useTaskStore((s) => s.activeTask);
  const executions = useTaskStore((s) => s.executions);
  const loadExecutions = useTaskStore((s) => s.loadExecutions);
  const pendingCommit = useProcessStore((s) => s.pendingCommit);
  const noChangesToCommit = useProcessStore((s) => s.noChangesStageId === stage.id);
  const committedHash = useProcessStore((s) => s.committedStages[stage.id]);

  const [sessionState, setSessionState] = useState<SessionState>("idle");
  const [error, setError] = useState<string | null>(null);
  const [commitMessage, setCommitMessage] = useState("");
  const [committing, setCommitting] = useState(false);
  const [commitError, setCommitError] = useState<string | null>(null);
  const [approving, setApproving] = useState(false);

  const ptyIdRef = useRef<string | null>(null);
  const xtermRef = useRef<XTerminalHandle>(null);
  const outputBufferRef = useRef("");
  const executionIdRef = useRef<string | null>(null);

  // Check if already approved
  const latestExecution = executions
    .filter((e) => e.stage_template_id === stage.id)
    .sort((a, b) => b.attempt_number - a.attempt_number)[0] ?? null;
  const isApproved = latestExecution?.status === "approved";

  // Sync commit message from pending commit
  useEffect(() => {
    if (pendingCommit?.stageId === stage.id) {
      setCommitMessage(pendingCommit.message);
    }
  }, [pendingCommit?.stageId, pendingCommit?.message, stage.id]);

  // Set initial state based on existing execution
  useEffect(() => {
    if (isApproved) {
      setSessionState("completed");
    }
  }, [isApproved]);

  const handleStart = useCallback(async () => {
    if (!activeProject || !activeTask) return;
    setSessionState("starting");
    setError(null);

    const prevAttempts = executions.filter((e) => e.stage_template_id === stage.id);
    const attemptNumber = prevAttempts.length + 1;
    const executionId = crypto.randomUUID();
    executionIdRef.current = executionId;

    try {
      // Build system prompt from prior stages (mirrors useStageExecution)
      const approvedOutputs = await repo.getApprovedStageOutputs(
        activeProject.id,
        activeTask.id,
      );

      let systemPrompt =
        "IMPORTANT: Do NOT run git add, git commit, or any git commands that stage or commit changes. The user will review and commit changes separately after this stage completes.";

      if (approvedOutputs.length > 0) {
        const stageLines = approvedOutputs
          .map((s) => `### ${s.stage_name}\n${s.stage_summary || "(no summary)"}`)
          .join("\n\n");
        const stageContext =
          `## Completed Pipeline Stages\nThe following stages have been completed for this task. Use the \`get_stage_output\` MCP tool to retrieve the full output of any stage if you need more detail.\n\n${stageLines}`;
        systemPrompt = `${systemPrompt}\n\n${stageContext}`;
      }

      // Build MCP config
      let mcpHint = "";
      try {
        const mcpServerPath = await invoke<string>("get_mcp_server_path");
        const devflowDir = await invoke<string>("get_devflow_dir");
        // Verify MCP server is available so we can hint the agent about it
        void mcpServerPath;
        void devflowDir;
        mcpHint =
          "You have access to `list_completed_stages`, `get_stage_output`, and `get_task_description` tools to retrieve data from prior pipeline stages on demand.";
        systemPrompt = `${systemPrompt}\n\n${mcpHint}`;
      } catch {
        // MCP unavailable — continue without it
      }

      // Create execution record
      await repo.createStageExecution(activeProject.id, {
        id: executionId,
        task_id: activeTask.id,
        stage_template_id: stage.id,
        attempt_number: attemptNumber,
        status: "running",
        input_prompt: "(interactive terminal session)",
        user_input: null,
        raw_output: null,
        parsed_output: null,
        user_decision: null,
        session_id: null,
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
      });

      await loadExecutions(activeProject.id, activeTask.id);

      const workDir = getTaskWorkingDir(activeTask, activeProject.path);

      // Spawn PTY
      outputBufferRef.current = "";
      const ptyId = await spawnPty(
        {
          workingDirectory: workDir,
          appendSystemPrompt: systemPrompt,
        },
        (event: PtyEvent) => {
          switch (event.type) {
            case "started":
              ptyIdRef.current = event.id;
              setSessionState("running");
              break;
            case "output":
              xtermRef.current?.write(event.data);
              outputBufferRef.current += event.data;
              break;
            case "exited":
              ptyIdRef.current = null;
              // If we were still "running", the user didn't click Finish — Claude exited on its own
              setSessionState((prev) => {
                if (prev === "running") return "finishing";
                return prev;
              });
              break;
            case "error":
              setError(event.message);
              break;
          }
        },
      );
      ptyIdRef.current = ptyId;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
      setSessionState("idle");
      // Mark execution as failed
      if (executionIdRef.current) {
        await repo.updateStageExecution(activeProject.id, executionIdRef.current, {
          status: "failed",
          error_message: msg,
          completed_at: new Date().toISOString(),
        }).catch((e) => logger.error("Failed to update execution after PTY spawn error", e));
        await loadExecutions(activeProject.id, activeTask.id).catch(() => {});
      }
    }
  }, [activeProject, activeTask, executions, stage, loadExecutions]);

  const handleFinish = useCallback(async () => {
    if (!activeProject || !activeTask) return;
    setSessionState("finishing");

    // Kill PTY if still alive
    if (ptyIdRef.current) {
      await killPty(ptyIdRef.current).catch(() => {});
      ptyIdRef.current = null;
    }

    const executionId = executionIdRef.current;
    if (!executionId) return;

    try {
      // Generate summary via one-shot claude -p call
      const rawOutput = outputBufferRef.current;
      const summaryPrompt = `Summarize what was accomplished in this interactive Claude session. Be concise (2-4 sentences). Here is the terminal output:\n\n${rawOutput.slice(-8000)}`;

      let summary = "";
      await spawnClaude(
        {
          prompt: summaryPrompt,
          workingDirectory: getTaskWorkingDir(activeTask, activeProject.path),
          noSessionPersistence: true,
          allowedTools: [],
          maxTurns: 1,
        },
        (event: ClaudeStreamEvent) => {
          if (event.type === "stdout_line") {
            try {
              const parsed = JSON.parse(event.line);
              if (parsed.type === "result") {
                summary = parsed.result ?? "";
              }
            } catch {
              // not JSON
            }
          }
        },
      );

      if (!summary) {
        summary = "Interactive Claude session completed.";
      }

      // Update execution
      await repo.updateStageExecution(activeProject.id, executionId, {
        status: "awaiting_user",
        raw_output: rawOutput.slice(-50000), // cap stored output
        parsed_output: summary,
        stage_result: summary,
        stage_summary: summary,
        completed_at: new Date().toISOString(),
      });

      await loadExecutions(activeProject.id, activeTask.id);

      // Generate pending commit
      await generatePendingCommit(activeTask, stage, activeProject.path, activeProject.id);

      setSessionState("awaiting_commit");
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
      // Mark as failed
      await repo.updateStageExecution(activeProject.id, executionId, {
        status: "failed",
        error_message: msg,
        completed_at: new Date().toISOString(),
      }).catch((e) => logger.error("Failed to update execution after finish error", e));
      await loadExecutions(activeProject.id, activeTask.id).catch(() => {});
      setSessionState("idle");
    }
  }, [activeProject, activeTask, stage, loadExecutions]);

  // When sessionState transitions to "finishing" and PTY is already dead, trigger finish logic
  useEffect(() => {
    if (sessionState === "finishing" && !ptyIdRef.current && executionIdRef.current) {
      handleFinish();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionState]);

  const handleStop = useCallback(async () => {
    if (ptyIdRef.current) {
      await killPty(ptyIdRef.current).catch(() => {});
      ptyIdRef.current = null;
    }
    setSessionState("idle");
    // Mark execution as failed
    if (activeProject && activeTask && executionIdRef.current) {
      await repo.updateStageExecution(activeProject.id, executionIdRef.current, {
        status: "failed",
        error_message: "Stopped by user",
        completed_at: new Date().toISOString(),
      }).catch(() => {});
      await loadExecutions(activeProject.id, activeTask.id).catch(() => {});
    }
  }, [activeProject, activeTask, loadExecutions]);

  const handleCommit = async () => {
    if (!activeProject || !activeTask || !pendingCommit || pendingCommit.stageId !== stage.id) return;
    setCommitting(true);
    setCommitError(null);
    try {
      const workDir = getTaskWorkingDir(activeTask, activeProject.path);
      await gitAdd(workDir);
      const result = await gitCommit(workDir, commitMessage);
      const hashMatch = result.match(/\[[\w/.-]+\s+([a-f0-9]+)\]/);
      const shortHash = hashMatch?.[1] ?? result.slice(0, 7);
      useProcessStore.getState().setCommitted(stage.id, shortHash);
      useProcessStore.getState().clearPendingCommit();
      sendNotification("Changes committed", shortHash, "success", {
        projectId: activeProject.id,
        taskId: activeTask.id,
      });
      await handleApprove();
    } catch (e) {
      setCommitError(e instanceof Error ? e.message : String(e));
    } finally {
      setCommitting(false);
    }
  };

  const handleApprove = async () => {
    if (!activeProject || !activeTask) return;
    setApproving(true);

    const executionId = executionIdRef.current;
    if (!executionId) return;

    try {
      // Clear commit state
      useProcessStore.getState().clearPendingCommit();
      useProcessStore.getState().setNoChangesToCommit(null);

      // Mark execution as approved
      await repo.updateStageExecution(activeProject.id, executionId, {
        status: "approved",
      });

      sendNotification("Stage approved", stage.name, "success", {
        projectId: activeProject.id,
        taskId: activeTask.id,
      });

      // Advance to next stage
      const taskStageTemplates = useTaskStore.getState().getActiveTaskStageTemplates();
      const nextStage = taskStageTemplates
        .filter((s) => s.sort_order > stage.sort_order)
        .sort((a, b) => a.sort_order - b.sort_order)[0] ?? null;

      if (nextStage) {
        await useTaskStore.getState().updateTask(activeProject.id, activeTask.id, {
          current_stage_id: nextStage.id,
        });
      } else {
        await useTaskStore.getState().updateTask(activeProject.id, activeTask.id, {
          status: "completed",
        });
      }

      await loadExecutions(activeProject.id, activeTask.id);
      setSessionState("completed");
    } catch (err) {
      logger.error("Failed to approve interactive terminal stage:", err);
      setApproving(false);
    }
  };

  if (!activeProject || !activeTask) return null;

  // Completed state
  if (sessionState === "completed" || isApproved) {
    return (
      <div className="p-6 max-w-4xl">
        <Alert className="border-emerald-200 dark:border-emerald-500/20 bg-emerald-50 dark:bg-emerald-500/10 text-emerald-800 dark:text-emerald-300">
          <svg className="w-4 h-4 text-emerald-600 dark:text-emerald-400 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
            <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
          </svg>
          <AlertDescription className="text-emerald-800 dark:text-emerald-300">
            Interactive session completed.
            {committedHash && (
              <> Committed: <code className="font-mono">{committedHash}</code></>
            )}
          </AlertDescription>
        </Alert>
        {latestExecution?.parsed_output && (
          <p className="mt-3 text-sm text-muted-foreground">
            {latestExecution.parsed_output}
          </p>
        )}
      </div>
    );
  }

  // Idle state — show start button
  if (sessionState === "idle") {
    return (
      <div className="p-6 max-w-4xl">
        <div className="p-4 bg-muted/50 border border-border rounded-lg">
          <div className="flex items-center gap-2 mb-3">
            <svg className="w-4 h-4 text-blue-600 dark:text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 9l3 3-3 3m5 0h3M5 20h14a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
            </svg>
            <span className="text-sm font-medium text-foreground">
              Interactive Claude Session
            </span>
          </div>
          <p className="text-sm text-muted-foreground mb-3">
            Launch a live Claude terminal where you can guide the AI step by step — type prompts, confirm tool uses, and steer the implementation interactively.
          </p>
          {error && (
            <Alert variant="destructive" className="mb-3">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
          <Button onClick={handleStart} size="sm">
            Start Interactive Session
          </Button>
        </div>
      </div>
    );
  }

  // Starting state
  if (sessionState === "starting") {
    return (
      <div className="p-6 max-w-4xl">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="w-4 h-4 animate-spin" />
          Starting interactive session...
        </div>
      </div>
    );
  }

  // Running state — full terminal
  if (sessionState === "running") {
    return (
      <div className="p-4 flex flex-col gap-3 h-full">
        <div className="flex-1 min-h-[400px]">
          <XTerminal
            ref={xtermRef}
            onData={(data) => {
              if (ptyIdRef.current) {
                writeToPty(ptyIdRef.current, data).catch(() => {});
              }
            }}
            onResize={(cols, rows) => {
              if (ptyIdRef.current) {
                resizePty(ptyIdRef.current, cols, rows).catch(() => {});
              }
            }}
          />
        </div>
        <div className="flex gap-2">
          <Button onClick={handleFinish} size="sm" variant="success">
            Finish Session
          </Button>
          <Button onClick={handleStop} size="sm" variant="outline">
            Stop
          </Button>
        </div>
      </div>
    );
  }

  // Finishing state
  if (sessionState === "finishing") {
    return (
      <div className="p-6 max-w-4xl">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="w-4 h-4 animate-spin" />
          Generating summary and checking for changes...
        </div>
      </div>
    );
  }

  // Awaiting commit state
  if (sessionState === "awaiting_commit") {
    return (
      <div className="p-6 max-w-4xl">
        {latestExecution?.parsed_output && (
          <div className="mb-4 p-3 bg-muted/50 border border-border rounded-lg">
            <p className="text-sm font-medium text-foreground mb-1">Session Summary</p>
            <p className="text-sm text-muted-foreground">{latestExecution.parsed_output}</p>
          </div>
        )}

        <CommitWorkflow
          pendingCommit={pendingCommit}
          stageId={stage.id}
          commitMessage={commitMessage}
          setCommitMessage={setCommitMessage}
          commitError={commitError}
          committing={committing}
          onCommit={handleCommit}
          noChangesToCommit={noChangesToCommit}
          outputHasOwnActionButton={false}
          onApprove={handleApprove}
          approving={approving}
          commitPrepTimedOut={false}
        />
      </div>
    );
  }

  return null;
}
