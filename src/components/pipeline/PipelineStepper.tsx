import { useMemo, memo } from "react";
import type { TaskStageInstance, StageExecution } from "../../lib/types";

interface PipelineStepperProps {
  stages: TaskStageInstance[];
  currentStageId: string | null;
  executions: StageExecution[];
  onStageClick: (stage: TaskStageInstance) => void;
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

    // Resolve effective current stage ID.
    // If currentStageId doesn't match any visible stage (stale pointer,
    // data inconsistency, or null), infer from execution state.
    let effectiveCurrentId = currentStageId;
    const currentIdMatchesStage = effectiveCurrentId && stages.some((s) => s.task_stage_id === effectiveCurrentId);
    if (!currentIdMatchesStage && !isTaskCompleted && stages.length > 0) {
      if (effectiveCurrentId) {
        console.warn(
          "[PipelineStepper] current_stage_id %s does not match any stage instance: %o",
          effectiveCurrentId,
          stages.map((s) => s.task_stage_id),
        );
      }
      const firstNonApproved = stages.find((s) => {
        const execs = executions.filter((e) => e.task_stage_id === s.task_stage_id);
        return !execs.some((e) => e.status === "approved");
      });
      effectiveCurrentId = firstNonApproved?.task_stage_id ?? stages[0].task_stage_id;
    }

    // Find the effective current stage's sort_order for position-based fallback
    const effectiveCurrentSort = stages.find((s) => s.task_stage_id === effectiveCurrentId)?.sort_order ?? -1;

    for (const stage of stages) {
      if (isTaskCompleted) {
        map.set(stage.task_stage_id, "completed");
        continue;
      }
      const stageExecs = executions.filter(
        (e) => e.task_stage_id === stage.task_stage_id,
      );
      const latestExec = stageExecs[stageExecs.length - 1];

      if (latestExec?.status === "approved") {
        map.set(stage.task_stage_id, "completed");
      } else if (stage.task_stage_id === effectiveCurrentId) {
        if (latestExec?.status === "running") map.set(stage.task_stage_id, "running");
        else if (latestExec?.status === "failed") map.set(stage.task_stage_id, "failed");
        else if (latestExec?.status === "awaiting_user") map.set(stage.task_stage_id, "awaiting");
        else map.set(stage.task_stage_id, "current");
      } else {
        const hasApprovedExec = stageExecs.some((e) => e.status === "approved");
        if (hasApprovedExec) {
          map.set(stage.task_stage_id, "completed");
        } else if (stage.sort_order < effectiveCurrentSort) {
          // Stage is before the current stage — must have been completed
          // (or skipped) to reach the current stage. Show as completed even
          // if executions have mismatched task_stage_ids.
          map.set(stage.task_stage_id, "completed");
        } else {
          map.set(stage.task_stage_id, "future");
        }
      }
    }
    return map;
  }, [stages, executions, currentStageId, isTaskCompleted]);

  return (
    <div className="flex items-center gap-1 px-6 py-4 overflow-x-auto min-w-0">
      {stages.map((stage, i) => (
        <PipelineStep
          key={stage.task_stage_id}
          stage={stage}
          status={stageStatusMap.get(stage.task_stage_id) ?? "future"}
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
  stage: TaskStageInstance;
  status: string;
  index: number;
  isLast: boolean;
  onStageClick: (stage: TaskStageInstance) => void;
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
              : status === "failed"
                ? "bg-red-50 dark:bg-red-950 text-red-700 dark:text-red-300 border border-red-200 dark:border-red-800"
                : status === "awaiting"
                  ? "bg-amber-50 dark:bg-amber-950 text-amber-700 dark:text-amber-300 border border-amber-200 dark:border-amber-800"
                  : status === "current"
                    ? "bg-zinc-100 dark:bg-zinc-800 text-zinc-800 dark:text-zinc-200 border border-zinc-300 dark:border-zinc-600"
                    : "bg-zinc-50 dark:bg-zinc-900 text-zinc-400 dark:text-zinc-500 border border-zinc-200 dark:border-zinc-700"
        }`}
      >
        <span
          className={`w-5 h-5 rounded-full flex items-center justify-center text-[0.77rem] font-bold ${
            status === "completed"
              ? "bg-emerald-500 text-white"
              : status === "running"
                ? "bg-blue-500 text-white"
                : status === "failed"
                  ? "bg-red-500 text-white"
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
          ) : status === "failed" ? (
            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M6 18L18 6M6 6l12 12" />
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
