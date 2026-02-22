import { useMemo, memo } from "react";
import type { StageTemplate, StageExecution } from "../../lib/types";

interface PipelineStepperProps {
  stages: StageTemplate[];
  currentStageId: string | null;
  executions: StageExecution[];
  onStageClick: (stage: StageTemplate) => void;
  isTaskCompleted?: boolean;
}

export function PipelineStepper({
  stages,
  currentStageId,
  executions,
  onStageClick,
  isTaskCompleted,
}: PipelineStepperProps) {
  const stageStatusMap = useMemo(() => {
    const map = new Map<string, string>();
    const currentStage = stages.find((s) => s.id === currentStageId);
    for (const stage of stages) {
      if (isTaskCompleted) {
        map.set(stage.id, "completed");
        continue;
      }
      const stageExecs = executions.filter(
        (e) => e.stage_template_id === stage.id,
      );
      const latestExec = stageExecs[stageExecs.length - 1];

      if (latestExec?.status === "approved") {
        map.set(stage.id, "completed");
      } else if (stage.id === currentStageId) {
        if (latestExec?.status === "running") map.set(stage.id, "running");
        else if (latestExec?.status === "awaiting_user") map.set(stage.id, "awaiting");
        else map.set(stage.id, "current");
      } else {
        if (currentStage && stage.sort_order < currentStage.sort_order) {
          map.set(stage.id, "completed");
        } else {
          map.set(stage.id, "future");
        }
      }
    }
    return map;
  }, [stages, executions, currentStageId, isTaskCompleted]);

  return (
    <div className="flex items-center gap-1 px-6 py-4 overflow-x-auto">
      {stages.map((stage, i) => (
        <PipelineStep
          key={stage.id}
          stage={stage}
          status={stageStatusMap.get(stage.id) ?? "future"}
          index={i}
          isLast={i === stages.length - 1}
          onStageClick={onStageClick}
        />
      ))}
    </div>
  );
}

const PipelineStep = memo(function PipelineStep({
  stage,
  status,
  index,
  isLast,
  onStageClick,
}: {
  stage: StageTemplate;
  status: string;
  index: number;
  isLast: boolean;
  onStageClick: (stage: StageTemplate) => void;
}) {
  return (
    <div className="flex items-center">
      <button
        onClick={() => onStageClick(stage)}
        className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-medium transition-all whitespace-nowrap ${
          status === "completed"
            ? "bg-emerald-50 dark:bg-emerald-950 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800"
            : status === "running"
              ? "bg-blue-50 dark:bg-blue-950 text-blue-700 dark:text-blue-300 border border-blue-200 dark:border-blue-800 animate-pulse"
              : status === "awaiting"
                ? "bg-amber-50 dark:bg-amber-950 text-amber-700 dark:text-amber-300 border border-amber-200 dark:border-amber-800"
                : status === "current"
                  ? "bg-zinc-100 dark:bg-zinc-800 text-zinc-800 dark:text-zinc-200 border border-zinc-300 dark:border-zinc-600"
                  : "bg-zinc-50 dark:bg-zinc-900 text-zinc-400 dark:text-zinc-500 border border-zinc-200 dark:border-zinc-700"
        }`}
      >
        <span
          className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold ${
            status === "completed"
              ? "bg-emerald-500 text-white"
              : status === "running"
                ? "bg-blue-500 text-white"
                : status === "awaiting"
                  ? "bg-amber-500 text-white"
                  : status === "current"
                    ? "bg-zinc-500 text-white"
                    : "bg-zinc-200 dark:bg-zinc-700 text-zinc-500 dark:text-zinc-400"
          }`}
        >
          {status === "completed" ? (
            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
            </svg>
          ) : (
            index + 1
          )}
        </span>
        {stage.name}
      </button>
      {!isLast && (
        <div
          className={`w-6 h-px mx-1 ${
            status === "completed" ? "bg-emerald-300 dark:bg-emerald-700" : "bg-zinc-200 dark:bg-zinc-700"
          }`}
        />
      )}
    </div>
  );
});
