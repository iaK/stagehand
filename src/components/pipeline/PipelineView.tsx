import { useState, useEffect, useMemo } from "react";
import { useTaskStore } from "../../stores/taskStore";
import { useProjectStore } from "../../stores/projectStore";
import { useProcessStore } from "../../stores/processStore";
import { PipelineStepper } from "./PipelineStepper";
import { StageView } from "./StageView";
import { MergeConfirmation } from "./MergeConfirmation";
import { TaskOverview } from "../task/TaskOverview";
import type { StageTemplate } from "../../lib/types";

export function PipelineView() {
  const activeProject = useProjectStore((s) => s.activeProject);
  const activeTask = useTaskStore((s) => s.activeTask);
  const executions = useTaskStore((s) => s.executions);
  const loadExecutions = useTaskStore((s) => s.loadExecutions);
  const loadTaskStages = useTaskStore((s) => s.loadTaskStages);
  const stageTemplates = useTaskStore((s) => s.stageTemplates);
  const taskStages = useTaskStore((s) => s.taskStages);

  // Compute filtered stages from stable selectors
  const activeTaskId = activeTask?.id;
  const filteredStages = useMemo(() => {
    if (!activeTaskId) return stageTemplates;
    const selectedIds = taskStages[activeTaskId];
    if (!selectedIds || selectedIds.length === 0) return stageTemplates;
    const idSet = new Set(selectedIds);
    return stageTemplates.filter((t) => idSet.has(t.id));
  }, [stageTemplates, taskStages, activeTaskId]);

  const [viewingStage, setViewingStage] = useState<StageTemplate | null>(null);
  const [activeView, setActiveView] = useState<"overview" | "pipeline">("pipeline");

  // Stable primitive values for effect dependencies
  const projectId = activeProject?.id;
  const currentStageId = activeTask?.current_stage_id;

  // Load executions and task stages when task changes
  useEffect(() => {
    if (projectId && activeTaskId) {
      loadExecutions(projectId, activeTaskId).catch((err) =>
        console.error("Failed to load executions:", err),
      );
      loadTaskStages(projectId, activeTaskId).catch((err) =>
        console.error("Failed to load task stages:", err),
      );
    }
  }, [projectId, activeTaskId, loadExecutions, loadTaskStages]);

  // Auto-select current stage
  useEffect(() => {
    if (currentStageId && filteredStages.length > 0) {
      const current = filteredStages.find(
        (s) => s.id === currentStageId,
      );
      setViewingStage(current ?? filteredStages[0]);
    } else if (filteredStages.length > 0) {
      setViewingStage(filteredStages[0]);
    } else {
      setViewingStage(null);
    }
  }, [currentStageId, filteredStages]);

  // Reset tab view when task changes
  useEffect(() => {
    setActiveView("pipeline");
  }, [activeTaskId]);

  // Sync viewed stage to process store so TerminalView can show the right output
  useEffect(() => {
    useProcessStore.getState().setViewingStageId(viewingStage?.id ?? null);
  }, [viewingStage]);

  if (!activeProject) {
    return (
      <div className="flex-1 flex items-center justify-center h-full">
        <div className="text-center">
          <p className="text-muted-foreground text-lg">Welcome to Stagehand</p>
          <p className="text-muted-foreground/60 text-sm mt-2">
            Create a project to get started
          </p>
        </div>
      </div>
    );
  }

  if (!activeTask) {
    return (
      <div className="flex-1 flex items-center justify-center h-full">
        <p className="text-muted-foreground">Select or create a task to begin</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header bar */}
      <div className="border-b border-border flex items-center">
        {/* Tab toggle */}
        <div className="flex items-center gap-1 px-4 py-3">
          <button
            onClick={() => setActiveView("overview")}
            className={`px-2.5 py-1 rounded text-xs font-medium transition-colors ${
              activeView === "overview"
                ? "bg-zinc-100 text-zinc-800 border border-zinc-300"
                : "text-zinc-400 hover:text-zinc-600"
            }`}
          >
            Overview
          </button>
          <button
            onClick={() => setActiveView("pipeline")}
            className={`px-2.5 py-1 rounded text-xs font-medium transition-colors ${
              activeView === "pipeline"
                ? "bg-zinc-100 text-zinc-800 border border-zinc-300"
                : "text-zinc-400 hover:text-zinc-600"
            }`}
          >
            Pipeline
          </button>
        </div>
        {activeView === "pipeline" && (
          <>
            <div className="w-px h-6 bg-border" />
            <PipelineStepper
              stages={filteredStages}
              currentStageId={currentStageId ?? null}
              executions={executions}
              onStageClick={setViewingStage}
            />
          </>
        )}
      </div>

      {/* Content */}
      {activeView === "overview" ? (
        <div className="flex-1 overflow-y-auto">
          <TaskOverview />
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto">
          {viewingStage ? (
            <StageView key={viewingStage.id} stage={viewingStage} />
          ) : (
            <div className="flex items-center justify-center h-full">
              <p className="text-muted-foreground">No stage selected</p>
            </div>
          )}
          {activeTask && <MergeConfirmation task={activeTask} />}
        </div>
      )}
    </div>
  );
}
