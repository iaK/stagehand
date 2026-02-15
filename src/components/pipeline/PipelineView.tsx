import { useState, useEffect, useMemo, useRef } from "react";
import { useTaskStore } from "../../stores/taskStore";
import { useProjectStore } from "../../stores/projectStore";
import { useProcessStore } from "../../stores/processStore";
import { PipelineStepper } from "./PipelineStepper";
import { StageView } from "./StageView";
import { Button } from "@/components/ui/button";
import type { StageTemplate } from "../../lib/types";

interface PipelineViewProps {
  onToggleHistory: () => void;
}

export function PipelineView({ onToggleHistory }: PipelineViewProps) {
  const activeProject = useProjectStore((s) => s.activeProject);
  const { activeTask, executions, loadExecutions, loadTaskStages } =
    useTaskStore();
  const rawFilteredStages = useTaskStore((s) => s.getActiveTaskStageTemplates());
  // Memoize by comparing IDs to avoid new array reference causing infinite re-renders
  const prevIdsRef = useRef<string>("");
  const prevFilteredRef = useRef<StageTemplate[]>(rawFilteredStages);
  const filteredStages = useMemo(() => {
    const ids = rawFilteredStages.map((s) => s.id).join(",");
    if (ids === prevIdsRef.current) return prevFilteredRef.current;
    prevIdsRef.current = ids;
    prevFilteredRef.current = rawFilteredStages;
    return rawFilteredStages;
  }, [rawFilteredStages]);

  const [viewingStage, setViewingStage] = useState<StageTemplate | null>(null);

  // Load executions and task stages when task changes
  useEffect(() => {
    if (activeProject && activeTask) {
      loadExecutions(activeProject.id, activeTask.id);
      loadTaskStages(activeProject.id, activeTask.id);
    }
  }, [activeProject, activeTask, loadExecutions, loadTaskStages]);

  // Auto-select current stage
  useEffect(() => {
    if (activeTask && filteredStages.length > 0) {
      const current = filteredStages.find(
        (s) => s.id === activeTask.current_stage_id,
      );
      setViewingStage(current ?? filteredStages[0]);
    } else {
      setViewingStage(null);
    }
  }, [activeTask, filteredStages]);

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
          currentStageId={activeTask.current_stage_id}
          executions={executions}
          onStageClick={setViewingStage}
        />
        <Button
          variant="outline"
          size="xs"
          onClick={onToggleHistory}
          className="mr-4"
        >
          History
        </Button>
      </div>

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
