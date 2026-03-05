import { useState, useCallback, useEffect, useRef, useMemo } from "react";
import { useProjectStore } from "../../stores/projectStore";
import { useTaskStore } from "../../stores/taskStore";
import { useProcessStore, type TerminalTab } from "../../stores/processStore";
import { spawnPty, killPty, checkAgentAvailable } from "../../lib/agent";
import { getTaskWorkingDir } from "../../lib/worktree";
import { routePtyOutput, clearPtyBuffer } from "../../lib/ptyRouter";
import * as repo from "../../lib/repositories";
import { sendNotification } from "../../lib/notifications";
import { logger } from "../../lib/logger";
import { TerminalTabPanel } from "./TerminalTabPanel";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Loader2, TerminalSquare, Plus, X } from "lucide-react";
import type { PtyEvent } from "../../lib/types";

interface Props {
  taskId: string;
  isVisible: boolean;
}

const AGENTS_TO_CHECK = ["claude", "codex"] as const;

function tabLabel(agent: string): string {
  if (agent === "shell") return "Terminal";
  return agent.charAt(0).toUpperCase() + agent.slice(1);
}

export function IntegratedTerminal({ taskId, isVisible }: Props) {
  const activeProject = useProjectStore((s) => s.activeProject);
  const tasks = useTaskStore((s) => s.tasks);
  const task = tasks.find((t) => t.id === taskId) ?? null;

  const tabOrder = useProcessStore((s) => s.terminalTabOrder[taskId]);
  const allTabs = useProcessStore((s) => s.terminalTabs);
  const activeTabId = useProcessStore((s) => s.activeTerminalTabId[taskId] ?? null);

  const tabs = useMemo(() => {
    if (!tabOrder) return [];
    return tabOrder.map((id) => allTabs[id]).filter(Boolean);
  }, [tabOrder, allTabs]);

  const [availableAgents, setAvailableAgents] = useState<string[]>([]);
  const [checkingAgents, setCheckingAgents] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [spawning, setSpawning] = useState(false);

  // Track spawned tabIds so we can reference them in PTY callbacks
  const tabPtyIds = useRef<Map<string, string>>(new Map());

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

  const handleSpawn = useCallback(async (agent: string) => {
    if (!activeProject || !task) {
      logger.warn("IntegratedTerminal handleSpawn: no activeProject or task", { activeProject: !!activeProject, task: !!task });
      return;
    }
    setSpawning(true);
    setError(null);

    const isRawShell = agent === "shell";

    try {
      let systemPrompt: string | undefined;

      if (!isRawShell) {
        const approvedOutputs = await repo.getApprovedStageOutputs(activeProject.id, taskId);

        systemPrompt =
          "IMPORTANT: Do NOT run git add, git commit, or any git commands that stage or commit changes. The user will review and commit changes separately after this stage completes.";

        if (approvedOutputs.length > 0) {
          const stageLines = approvedOutputs
            .map((s) => `### ${s.stage_name}\n${s.stage_summary || "(no summary)"}`)
            .join("\n\n");
          const stageContext =
            `## Completed Pipeline Stages\nThe following stages have been completed for this task. Use the \`get_stage_output\` MCP tool to retrieve the full output of any stage if you need more detail.\n\n${stageLines}`;
          systemPrompt = `${systemPrompt}\n\n${stageContext}`;
        }

        const mcpHint =
          "You have access to `list_completed_stages`, `get_stage_output`, and `get_task_title` tools to retrieve data from prior pipeline stages on demand.";
        systemPrompt = `${systemPrompt}\n\n${mcpHint}`;
      }

      const workDir = getTaskWorkingDir(task, activeProject.path);

      // Create the tab in the store (status: running, ptyId: null until started event)
      const tabId = useProcessStore.getState().addTerminalTab(taskId, agent);

      await spawnPty(
        {
          agent: isRawShell ? undefined : agent,
          workingDirectory: workDir,
          appendSystemPrompt: systemPrompt,
        },
        (event: PtyEvent) => {
          switch (event.type) {
            case "started":
              tabPtyIds.current.set(tabId, event.id);
              useProcessStore.getState().updateTerminalTab(tabId, { ptyId: event.id });
              break;
            case "output":
              routePtyOutput(tabId, event.data);
              break;
            case "exited": {
              tabPtyIds.current.delete(tabId);
              useProcessStore.getState().updateTerminalTab(tabId, { ptyId: null, status: "exited" });
              const state = useProcessStore.getState();
              const isCurrentlyVisible = state.activeView === "terminal" && useTaskStore.getState().activeTask?.id === taskId;
              if (!isCurrentlyVisible && activeProject) {
                sendNotification(
                  "Terminal session ended",
                  task?.title ?? "Terminal session ended",
                  "info",
                  { projectId: activeProject.id, taskId, openTerminal: true },
                );
              }
              break;
            }
            case "error":
              setError(event.message);
              useProcessStore.getState().removeTerminalTab(taskId, tabId);
              break;
          }
        },
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
      logger.error("IntegratedTerminal spawn failed", err);
    } finally {
      setSpawning(false);
    }
  }, [activeProject, task, taskId]);

  const handleCloseTab = useCallback(async (tab: TerminalTab) => {
    // Kill PTY if running
    const ptyId = tab.ptyId ?? tabPtyIds.current.get(tab.id);
    if (ptyId) {
      await killPty(ptyId).catch(() => {});
      tabPtyIds.current.delete(tab.id);
    }
    clearPtyBuffer(tab.id);
    useProcessStore.getState().removeTerminalTab(taskId, tab.id);
  }, [taskId]);

  const [showNewTabPicker, setShowNewTabPicker] = useState(false);
  const pickerRef = useRef<HTMLDivElement>(null);

  // Close picker on outside click
  useEffect(() => {
    if (!showNewTabPicker) return;
    function onClickOutside(e: MouseEvent) {
      if (pickerRef.current && !pickerRef.current.contains(e.target as Node)) {
        setShowNewTabPicker(false);
      }
    }
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, [showNewTabPicker]);

  const spawnAndClosePicker = useCallback((agent: string) => {
    setShowNewTabPicker(false);
    handleSpawn(agent);
  }, [handleSpawn]);

  const hasWorktree = !!task?.worktree_path;
  const hasTabs = tabs.length > 0;

  return (
    <div className="flex flex-col h-full">
      {/* Tab bar */}
      <div className="flex items-center px-2 py-1.5 border-b border-border shrink-0 gap-1 min-h-[41px]">
        {tabs.map((tab) => (
          <div
            key={tab.id}
            className={`group flex items-center gap-1 px-2.5 py-1 rounded-md text-xs cursor-pointer select-none transition-colors ${
              tab.id === activeTabId
                ? "bg-accent text-accent-foreground"
                : "text-muted-foreground hover:bg-muted hover:text-foreground"
            } ${tab.status === "exited" ? "opacity-60" : ""}`}
            onClick={() => useProcessStore.getState().setActiveTerminalTab(taskId, tab.id)}
          >
            <TerminalSquare className="w-3 h-3 shrink-0" />
            <span>{tabLabel(tab.agent)}</span>
            <button
              className="ml-0.5 p-0.5 rounded hover:bg-foreground/10 opacity-0 group-hover:opacity-100 transition-opacity"
              onClick={(e) => { e.stopPropagation(); handleCloseTab(tab); }}
            >
              <X className="w-3 h-3" />
            </button>
          </div>
        ))}

        {/* New tab button */}
        {hasWorktree && !checkingAgents && (
          <div className="relative" ref={pickerRef}>
            <button
              className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
              disabled={spawning}
              onClick={() => setShowNewTabPicker((v) => !v)}
            >
              {spawning ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
            </button>
            {showNewTabPicker && (
              <div className="absolute top-full left-0 mt-1 z-50 bg-popover border border-border rounded-md shadow-md py-1 min-w-[120px]">
                <button
                  className="w-full text-left px-3 py-1.5 text-xs hover:bg-accent hover:text-accent-foreground transition-colors"
                  onClick={() => spawnAndClosePicker("shell")}
                >
                  Terminal
                </button>
                {availableAgents.map((agent) => (
                  <button
                    key={agent}
                    className="w-full text-left px-3 py-1.5 text-xs hover:bg-accent hover:text-accent-foreground transition-colors"
                    onClick={() => spawnAndClosePicker(agent)}
                  >
                    {tabLabel(agent)}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Terminal area */}
      <div className="flex-1 relative min-h-0">
        {/* Render all tab panels — hidden unless active */}
        {tabs.map((tab) => (
          <div
            key={tab.id}
            className="absolute inset-0"
            style={{ display: tab.id === activeTabId ? "flex" : "none", flexDirection: "column" }}
          >
            <TerminalTabPanel tabId={tab.id} isVisible={isVisible && tab.id === activeTabId} />
          </div>
        ))}

        {/* Empty state — no tabs */}
        {!hasTabs && (
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
              ) : (
                <div className="flex flex-col items-center gap-3">
                  <p className="text-sm text-muted-foreground">Spawn a session</p>
                  <div className="flex gap-2 flex-wrap justify-center">
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={spawning}
                      onClick={() => handleSpawn("shell")}
                    >
                      {spawning ? <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" /> : null}
                      Terminal
                    </Button>
                    {availableAgents.map((agent) => (
                      <Button
                        key={agent}
                        variant="outline"
                        size="sm"
                        disabled={spawning}
                        onClick={() => handleSpawn(agent)}
                      >
                        {spawning ? <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" /> : null}
                        {tabLabel(agent)}
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
