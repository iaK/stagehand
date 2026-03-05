import { useState, useEffect, useMemo, useRef, useCallback } from "react";
import { useTaskStore } from "../../stores/taskStore";
import { useProjectStore } from "../../stores/projectStore";
import { useProcessStore, stageKey } from "../../stores/processStore";
import { PipelineStepper } from "./PipelineStepper";
import { StageView } from "./StageView";
import { InteractiveTerminalStageView } from "./InteractiveTerminalStageView";
import { IntegratedTerminal } from "./IntegratedTerminal";
import { TaskOverview } from "../task/TaskOverview";
import { ProjectOverview } from "../project/ProjectOverview";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip";
import { Code2, Terminal, GitBranch, Info } from "lucide-react";
import { logger } from "../../lib/logger";
import { useEditorStore } from "../../stores/editorStore";
import { useNavigationStore } from "../../stores/navigationStore";
import { EditorPanel } from "../editor/EditorPanel";
import type { TaskStageInstance } from "../../lib/types";

export function PipelineView() {
  const activeProject = useProjectStore((s) => s.activeProject);
  const activeTask = useTaskStore((s) => s.activeTask);
  const executions = useTaskStore((s) => s.executions);
  const loadExecutions = useTaskStore((s) => s.loadExecutions);
  const loadTaskStages = useTaskStore((s) => s.loadTaskStages);
  const getActiveTaskStageInstances = useTaskStore((s) => s.getActiveTaskStageInstances);
  const taskStagesMap = useTaskStore((s) => s.taskStages);

  // Stable primitive values for effect dependencies
  const projectId = activeProject?.id;

  // Compute filtered stages from stable selectors
  const activeTaskId = activeTask?.id;
  const activeTaskStages = activeTaskId ? taskStagesMap[activeTaskId] : undefined;
  const filteredStages = useMemo(() => {
    return getActiveTaskStageInstances();
  }, [getActiveTaskStageInstances, activeTaskId, activeTask?.current_stage_id, activeTaskStages]);

  const [viewingStage, setViewingStageRaw] = useState<TaskStageInstance | null>(null);

  const activePtySessions = useProcessStore((s) => s.activePtySessions);
  const activeView = useProcessStore((s) => s.activeView);
  const showOverview = useProcessStore((s) => s.overviewOpen);
  const terminalTabOrder = useProcessStore((s) => s.terminalTabOrder);

  // Task IDs that need a mounted IntegratedTerminal (have tabs or are active)
  const terminalTaskIds = useMemo(() => {
    const ids = new Set<string>(
      Object.entries(terminalTabOrder)
        .filter(([, tabs]) => tabs.length > 0)
        .map(([tid]) => tid),
    );
    if (activeTaskId) ids.add(activeTaskId);
    return Array.from(ids);
  }, [terminalTabOrder, activeTaskId]);

  // Track whether we've restored view state for this task (avoid overwriting with auto-select)
  const restoredTaskRef = useRef<string | null>(null);

  // --- Navigation persistence helpers ---
  const persistViewPatch = useCallback(
    (patch: Partial<{ stageId: string | null; activeView: "pipeline" | "editor" | "terminal"; overview: boolean }>) => {
      if (projectId && activeTaskId) {
        useNavigationStore.getState().persistTaskViewState(projectId, activeTaskId, patch);
      }
    },
    [projectId, activeTaskId],
  );

  const setViewingStage = useCallback(
    (stage: TaskStageInstance | null) => {
      setViewingStageRaw(stage);
      if (stage && projectId && activeTaskId) {
        useNavigationStore.getState().persistTaskViewState(projectId, activeTaskId, {
          stageId: stage.task_stage_id,
        });
      }
    },
    [projectId, activeTaskId],
  );

  const switchView = useCallback((view: "pipeline" | "editor" | "terminal") => {
    useProcessStore.getState().setActiveView(view);
    persistViewPatch({ activeView: view });
  }, [persistViewPatch]);

  const handleToggleOverview = useCallback(() => {
    const next = !useProcessStore.getState().overviewOpen;
    useProcessStore.getState().toggleOverview();
    persistViewPatch({ overview: next });
  }, [persistViewPatch]);

  const currentStageId = activeTask?.current_stage_id;

  // Load executions and task stages when task changes
  useEffect(() => {
    if (projectId && activeTaskId) {
      loadExecutions(projectId, activeTaskId).catch((err) =>
        logger.error("Failed to load executions:", err),
      );
      loadTaskStages(projectId, activeTaskId).catch((err) =>
        logger.error("Failed to load task stages:", err),
      );
    }
  }, [projectId, activeTaskId, loadExecutions, loadTaskStages]);

  // Restore persisted view state when task changes, then auto-select stage
  useEffect(() => {
    if (!activeTaskId || filteredStages.length === 0) {
      setViewingStageRaw(null);
      return;
    }

    // If we already restored for this task, just follow current_stage_id changes
    if (restoredTaskRef.current === activeTaskId) {
      if (currentStageId) {
        const current = filteredStages.find((s) => s.task_stage_id === currentStageId);
        setViewingStageRaw(current ?? filteredStages[0]);
      }
      return;
    }

    // First time seeing this task — restore persisted state
    restoredTaskRef.current = activeTaskId;

    if (!projectId) {
      // Fallback: use current stage
      const current = filteredStages.find((s) => s.task_stage_id === currentStageId);
      setViewingStageRaw(current ?? filteredStages[0]);
      return;
    }

    const nav = useNavigationStore.getState();
    nav.getPersistedTaskViewState(projectId, activeTaskId).then((viewState) => {
      // Only apply if we're still on the same task
      if (useTaskStore.getState().activeTask?.id !== activeTaskId) return;

      // Restore panel states
      useProcessStore.getState().setActiveView(viewState.activeView);
      useEditorStore.getState().setSidebarView(viewState.editorSidebarView);
      useProcessStore.getState().setOverviewOpen(viewState.overview);

      // Restore viewing stage
      if (viewState.stageId) {
        const persisted = filteredStages.find((s) => s.task_stage_id === viewState.stageId);
        if (persisted) {
          setViewingStageRaw(persisted);
          return;
        }
      }

      // Fallback to current stage
      const current = filteredStages.find((s) => s.task_stage_id === currentStageId);
      setViewingStageRaw(current ?? filteredStages[0]);
    });
  }, [activeTaskId, currentStageId, filteredStages, projectId]);

  // Sync viewed stage to process store so TerminalView can show the right output
  useEffect(() => {
    const sk = activeTaskId && viewingStage ? stageKey(activeTaskId, viewingStage.task_stage_id) : null;
    useProcessStore.getState().setViewingStageId(sk);
  }, [viewingStage, activeTaskId]);

  // Placeholder screens when no project/task — rendered alongside (not instead of)
  // the mounted stages so that hidden terminals survive project/task switches.
  const showPlaceholder = !activeProject || !activeTask;

  return (
    <div className="flex flex-col h-full">
      {!activeProject && (
        <div className="flex-1 flex items-center justify-center h-full">
          <div className="text-center">
            <p className="text-muted-foreground text-lg">Welcome to Stagehand</p>
            <p className="text-muted-foreground/60 text-sm mt-2">
              Create a project to get started
            </p>
          </div>
        </div>
      )}

      {activeProject && !activeTask && (
        <div className="flex-1 overflow-y-auto">
          <ProjectOverview />
        </div>
      )}

      {/* Header bar */}
      <div className="border-b border-border flex items-center h-[57px]" style={{ display: showPlaceholder ? "none" : undefined }}>
        <PipelineStepper
          stages={filteredStages}
          currentStageId={currentStageId ?? null}
          executions={executions}
          onStageClick={setViewingStage}
        />
        <div className="ml-auto pl-4 pr-4 flex items-center gap-1 shrink-0">
          {/* View switcher */}
          <div className="flex items-center rounded-md border border-border bg-muted/40 p-0.5 gap-0.5">
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant={activeView === "pipeline" ? "secondary" : "ghost"}
                  size="icon-xs"
                  onClick={() => switchView("pipeline")}
                >
                  <GitBranch className="w-3.5 h-3.5" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Pipeline</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant={activeView === "editor" ? "secondary" : "ghost"}
                  size="icon-xs"
                  onClick={() => switchView("editor")}
                >
                  <Code2 className="w-3.5 h-3.5" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Editor</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant={activeView === "terminal" ? "secondary" : "ghost"}
                  size="icon-xs"
                  onClick={() => switchView("terminal")}
                >
                  <Terminal className="w-3.5 h-3.5" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Terminal</TooltipContent>
            </Tooltip>
          </div>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant={showOverview ? "secondary" : "ghost"}
                size="icon-xs"
                onClick={handleToggleOverview}
              >
                <Info className="w-3.5 h-3.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>{showOverview ? "Hide Overview" : "Show Overview"}</TooltipContent>
          </Tooltip>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 flex min-h-0" style={{ display: showPlaceholder ? "none" : undefined }}>
        {activeView === "editor" ? (
          <EditorPanel />
        ) : activeView === "pipeline" ? (
          /* Pipeline (default view) */
          <div className="flex-1 overflow-y-auto relative">

            {/* Layer 1: Persistent interactive terminals — survive navigation */}
            {(() => {
              const persistentTerminals = new Map<string, { taskId: string; stage: TaskStageInstance }>();

              for (const [key, session] of Object.entries(activePtySessions)) {
                persistentTerminals.set(key, { taskId: session.taskId, stage: session.stage });
              }

              if (activeTaskId && viewingStage?.output_format === "interactive_terminal") {
                const key = stageKey(activeTaskId, viewingStage.task_stage_id);
                if (!persistentTerminals.has(key)) {
                  persistentTerminals.set(key, { taskId: activeTaskId, stage: viewingStage });
                }
              }

              const currentKey = activeTaskId && viewingStage
                ? stageKey(activeTaskId, viewingStage.task_stage_id)
                : null;

              return Array.from(persistentTerminals.entries()).map(([key, { taskId: tId, stage: s }]) => {
                const isVisible = key === currentKey;
                return (
                  <div
                    key={`pty-${key}`}
                    className="absolute inset-0"
                    style={{ display: isVisible ? "flex" : "none", flexDirection: "column" }}
                  >
                    <InteractiveTerminalStageView stage={s} taskId={tId} isVisible={isVisible} />
                  </div>
                );
              });
            })()}

            {/* Layer 2: Regular StageView — only for non-interactive-terminal stages */}
            {viewingStage ? (
              viewingStage.output_format !== "interactive_terminal" ? (
                <StageView key={`${activeTaskId}-${viewingStage.task_stage_id}`} stage={viewingStage} taskId={activeTaskId!} />
              ) : null
            ) : (
              <div className="flex items-center justify-center h-full">
                <p className="text-muted-foreground">No stage selected</p>
              </div>
            )}
          </div>
        ) : null}

        {/* Integrated terminals — always mounted, survive project/task switches */}
        {terminalTaskIds.map((tid) => {
          const termVisible = activeView === "terminal" && tid === activeTaskId;
          return (
            <div
              key={`term-${tid}`}
              className="flex-1 flex flex-col min-h-0"
              style={{ display: termVisible ? "flex" : "none" }}
            >
              <IntegratedTerminal taskId={tid} isVisible={termVisible} />
            </div>
          );
        })}

        {/* Overview panel (collapsible right side) */}
        {showOverview && (
          <div className="w-[400px] shrink-0 border-l border-border flex flex-col min-h-0">
            <TaskOverview />
          </div>
        )}
      </div>

    </div>
  );
}
