import { useState, useEffect, useMemo } from "react";
import { useTaskStore } from "../../stores/taskStore";
import { useProjectStore } from "../../stores/projectStore";
import { useProcessStore } from "../../stores/processStore";
import { PipelineStepper } from "./PipelineStepper";
import { StageView } from "./StageView";
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
      {/* Stepper */}
      <div className="border-b border-border flex items-center">
        <PipelineStepper
          stages={filteredStages}
          currentStageId={currentStageId ?? ""}
          executions={executions}
          onStageClick={setViewingStage}
          isTaskCompleted={activeTask?.status === "completed"}
        />
      </div>

      {/* Stage name + description bar */}
      {viewingStage && (
        <div className="border-b border-border px-6 py-2 flex items-baseline gap-2 min-w-0">
          <h2 className="text-sm font-semibold text-foreground shrink-0">{viewingStage.name}</h2>
          <span className="text-xs text-muted-foreground truncate">{viewingStage.description}</span>
        </div>
      )}

      {/* Stage Content */}
      <div className="flex-1 overflow-y-auto">
        {viewingStage ? (
          <StageView key={viewingStage.id} stage={viewingStage} />
        ) : (
          <div className="flex items-center justify-center h-full">
            <p className="text-muted-foreground">No stage selected</p>
          </div>
        )}
      </div>
    </div>
  );
}
