import { useState, useRef, useCallback, useEffect } from "react";
import { useProjectStore } from "../../stores/projectStore";
import { useTaskStore } from "../../stores/taskStore";
import { useProcessStore } from "../../stores/processStore";
import { spawnPty, writeToPty, resizePty, killPty, checkAgentAvailable } from "../../lib/agent";
import { getTaskWorkingDir } from "../../lib/worktree";
import { registerPtyWriter, unregisterPtyWriter, routePtyOutput, clearPtyRoute } from "../../lib/ptyRouter";
import * as repo from "../../lib/repositories";
import { sendNotification } from "../../lib/notifications";
import { logger } from "../../lib/logger";
import { XTerminal, type XTerminalHandle } from "./XTerminal";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Loader2, TerminalSquare } from "lucide-react";
import type { PtyEvent } from "../../lib/types";

interface Props {
  taskId: string;
  isVisible: boolean;
}

const AGENTS_TO_CHECK = ["claude", "codex"] as const;

export function IntegratedTerminal({ taskId, isVisible }: Props) {
  const activeProject = useProjectStore((s) => s.activeProject);
  const tasks = useTaskStore((s) => s.tasks);
  const task = tasks.find((t) => t.id === taskId) ?? null;
  const terminalSession = useProcessStore((s) => s.getTerminalSession(taskId));

  const [availableAgents, setAvailableAgents] = useState<string[]>([]);
  const [checkingAgents, setCheckingAgents] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [spawning, setSpawning] = useState(false);

  const xtermRef = useRef<XTerminalHandle | null>(null);
  const ptyIdRef = useRef<string | null>(null);

  // Detect available agents on mount
  useEffect(() => {
    let cancelled = false;
    async function detect() {
      const found: string[] = [];
      for (const agent of AGENTS_TO_CHECK) {
        try {
          await checkAgentAvailable(agent);
          found.push(agent);
        } catch {
          // not available
        }
      }
      if (!cancelled) {
        setAvailableAgents(found);
        setCheckingAgents(false);
      }
    }
    detect();
    return () => { cancelled = true; };
  }, []);

  // Sync ptyIdRef from the store so input/resize work after remount
  useEffect(() => {
    ptyIdRef.current = terminalSession.ptyId;
  }, [terminalSession.ptyId]);

  // Register this component's XTerminal as the writer for this task.
  // On mount, any buffered output from while no writer was active is replayed.
  // On unmount, the writer is removed so output is buffered again.
  // The PTY is NOT killed — it keeps running in the background.
  useEffect(() => {
    registerPtyWriter(taskId, (data) => xtermRef.current?.write(data));
    return () => { unregisterPtyWriter(taskId); };
  }, [taskId]);

  // Scroll/refit when visibility changes
  useEffect(() => {
    if (isVisible) {
      xtermRef.current?.focus();
    }
  }, [isVisible]);

  const handleSpawn = useCallback(async (agent: string) => {
    if (!activeProject || !task) {
      logger.warn("IntegratedTerminal handleSpawn: no activeProject or task", { activeProject: !!activeProject, task: !!task });
      return;
    }
    setSpawning(true);
    setError(null);

    try {
      // Build system prompt from approved stage outputs
      const approvedOutputs = await repo.getApprovedStageOutputs(activeProject.id, taskId);

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

      // Add MCP tools hint to system prompt
      try {
        const mcpHint =
          "You have access to `list_completed_stages`, `get_stage_output`, and `get_task_title` tools to retrieve data from prior pipeline stages on demand.";
        systemPrompt = `${systemPrompt}\n\n${mcpHint}`;
      } catch {
        // MCP unavailable — continue without it
      }

      const workDir = getTaskWorkingDir(task, activeProject.path);

      useProcessStore.getState().updateTerminalSession(taskId, {
        ptyId: null,
        status: "running",
        agent,
      });

      // Capture taskId for the callback closure (stable for this spawn)
      const spawnTaskId = taskId;

      await spawnPty(
        {
          agent,
          workingDirectory: workDir,
          appendSystemPrompt: systemPrompt,
        },
        (event: PtyEvent) => {
          switch (event.type) {
            case "started":
              ptyIdRef.current = event.id;
              useProcessStore.getState().updateTerminalSession(spawnTaskId, { ptyId: event.id, status: "running" });
              break;
            case "output":
              // Route through ptyRouter so output reaches whatever terminal
              // is currently displaying this task (survives task switches)
              routePtyOutput(spawnTaskId, event.data);
              break;
            case "exited": {
              ptyIdRef.current = null;
              useProcessStore.getState().updateTerminalSession(spawnTaskId, { ptyId: null, status: "exited" });
              const state = useProcessStore.getState();
              const isCurrentlyVisible = state.terminalOpen && useTaskStore.getState().activeTask?.id === spawnTaskId;
              if (!isCurrentlyVisible && activeProject) {
                sendNotification(
                  "Terminal session ended",
                  task?.title ?? "Terminal session ended",
                  "info",
                  { projectId: activeProject.id, taskId: spawnTaskId, openTerminal: true },
                );
              }
              break;
            }
            case "error":
              setError(event.message);
              useProcessStore.getState().updateTerminalSession(spawnTaskId, { ptyId: null, status: "idle" });
              break;
          }
        },
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
      useProcessStore.getState().updateTerminalSession(taskId, { ptyId: null, status: "idle" });
      logger.error("IntegratedTerminal spawn failed", err);
    } finally {
      setSpawning(false);
    }
  }, [activeProject, task, taskId]);

  const handleKill = useCallback(async () => {
    const ptyId = ptyIdRef.current ?? useProcessStore.getState().getTerminalSession(taskId).ptyId;
    if (ptyId) {
      await killPty(ptyId).catch(() => {});
      ptyIdRef.current = null;
    }
    clearPtyRoute(taskId);
    useProcessStore.getState().updateTerminalSession(taskId, { ptyId: null, status: "idle" });
  }, [taskId]);

  const handleRestart = useCallback(() => {
    setError(null);
    clearPtyRoute(taskId);
    useProcessStore.getState().updateTerminalSession(taskId, { ptyId: null, status: "idle" });
  }, [taskId]);

  const handleData = useCallback((data: string) => {
    if (ptyIdRef.current) {
      writeToPty(ptyIdRef.current, data).catch(() => {});
    }
  }, []);

  const handleResize = useCallback((cols: number, rows: number) => {
    if (ptyIdRef.current) {
      resizePty(ptyIdRef.current, cols, rows).catch(() => {});
    }
  }, []);

  const hasWorktree = !!task?.worktree_path;
  const status = terminalSession.status;

  return (
    <div className="flex flex-col h-full">
      {/* Header bar */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-border shrink-0">
        <div className="flex items-center gap-2">
          <TerminalSquare className="w-4 h-4 text-muted-foreground" />
          <span className="text-sm font-medium">Terminal</span>
          {terminalSession.agent && status !== "idle" && (
            <span className="text-xs text-muted-foreground">({terminalSession.agent})</span>
          )}
        </div>
        {status === "running" && (
          <Button variant="ghost" size="sm" onClick={handleKill} className="h-7 text-xs text-destructive hover:text-destructive">
            Kill
          </Button>
        )}
      </div>

      {/* Terminal area */}
      <div className="flex-1 relative min-h-0">
        {/* XTerminal — always mounted once running/exited to preserve output */}
        <div
          className="absolute inset-0 p-2"
          style={{
            display: "flex",
            flexDirection: "column",
            visibility: status === "idle" ? "hidden" : "visible",
            pointerEvents: status === "idle" ? "none" : "auto",
          }}
        >
          <XTerminal
            ref={xtermRef}
            onData={handleData}
            onResize={handleResize}
            isVisible={isVisible && status !== "idle"}
          />
        </div>

        {/* Exited overlay */}
        {status === "exited" && (
          <div className="absolute inset-0 flex items-end justify-center pb-8 pointer-events-none">
            <div className="pointer-events-auto bg-background/90 border border-border rounded-lg px-4 py-3 flex flex-col items-center gap-2 shadow-lg">
              <p className="text-sm text-muted-foreground">Session ended</p>
              <Button size="sm" onClick={handleRestart}>
                Restart
              </Button>
            </div>
          </div>
        )}

        {/* Idle — agent selection */}
        {status === "idle" && (
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="flex flex-col items-center gap-4 max-w-sm text-center">
              <TerminalSquare className="w-10 h-10 text-muted-foreground/40" />

              {error && (
                <Alert variant="destructive" className="text-left">
                  <AlertDescription>{error}</AlertDescription>
                </Alert>
              )}

              {!hasWorktree ? (
                <p className="text-sm text-muted-foreground">
                  Run a pipeline stage first to create the worktree
                </p>
              ) : checkingAgents ? (
                <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
              ) : availableAgents.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No supported agents found. Install Claude or Codex to use the terminal.
                </p>
              ) : (
                <div className="flex flex-col items-center gap-3">
                  <p className="text-sm text-muted-foreground">Spawn an agent session</p>
                  <div className="flex gap-2">
                    {availableAgents.map((agent) => (
                      <Button
                        key={agent}
                        variant="outline"
                        size="sm"
                        disabled={spawning}
                        onClick={() => handleSpawn(agent)}
                      >
                        {spawning ? (
                          <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />
                        ) : null}
                        Spawn {agent.charAt(0).toUpperCase() + agent.slice(1)}
                      </Button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
