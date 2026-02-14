import { useState, useEffect } from "react";
import { useTaskStore } from "../../stores/taskStore";
import { useProjectStore } from "../../stores/projectStore";
import { PipelineStepper } from "./PipelineStepper";
import { StageView } from "./StageView";
import type { StageTemplate } from "../../lib/types";

interface PipelineViewProps {
  onToggleHistory: () => void;
}

export function PipelineView({ onToggleHistory }: PipelineViewProps) {
  const activeProject = useProjectStore((s) => s.activeProject);
  const { activeTask, stageTemplates, executions, loadExecutions } =
    useTaskStore();
  const [viewingStage, setViewingStage] = useState<StageTemplate | null>(null);

  // Load executions when task changes
  useEffect(() => {
    if (activeProject && activeTask) {
      loadExecutions(activeProject.id, activeTask.id);
    }
  }, [activeProject, activeTask, loadExecutions]);

  // Auto-select current stage
  useEffect(() => {
    if (activeTask && stageTemplates.length > 0) {
      const current = stageTemplates.find(
        (s) => s.id === activeTask.current_stage_id,
      );
      setViewingStage(current ?? stageTemplates[0]);
    } else {
      setViewingStage(null);
    }
  }, [activeTask, stageTemplates]);

  if (!activeProject) {
    return (
      <div className="flex-1 flex items-center justify-center h-full">
        <div className="text-center">
          <p className="text-zinc-500 text-lg">Welcome to Stagehand</p>
          <p className="text-zinc-600 text-sm mt-2">
            Create a project to get started
          </p>
        </div>
      </div>
    );
  }

  if (!activeTask) {
    return (
      <div className="flex-1 flex items-center justify-center h-full">
        <p className="text-zinc-500">Select or create a task to begin</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* Stepper */}
      <div className="border-b border-zinc-800 flex items-center">
        <PipelineStepper
          stages={stageTemplates}
          currentStageId={activeTask.current_stage_id}
          executions={executions}
          onStageClick={setViewingStage}
        />
        <button
          onClick={onToggleHistory}
          className="px-3 py-1.5 mr-4 text-xs text-zinc-500 hover:text-zinc-300 border border-zinc-800 rounded transition-colors"
          title="Toggle completed stages panel"
        >
          History
        </button>
      </div>

      {/* Stage Content */}
      <div className="flex-1 overflow-y-auto">
        {viewingStage ? (
          <StageView stage={viewingStage} />
        ) : (
          <div className="flex items-center justify-center h-full">
            <p className="text-zinc-600">No stage selected</p>
          </div>
        )}
      </div>
    </div>
  );
}
