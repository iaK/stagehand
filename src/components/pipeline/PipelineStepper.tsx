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
  const getStageStatus = (stage: StageTemplate) => {
    // All stages are completed when the task is done
    if (isTaskCompleted) return "completed";

    const stageExecs = executions.filter(
      (e) => e.stage_template_id === stage.id,
    );
    const latestExec = stageExecs[stageExecs.length - 1];

    if (latestExec?.status === "approved") return "completed";
    if (stage.id === currentStageId) {
      if (latestExec?.status === "running") return "running";
      if (latestExec?.status === "awaiting_user") return "awaiting";
      return "current";
    }

    const currentStage = stages.find((s) => s.id === currentStageId);
    if (currentStage && stage.sort_order < currentStage.sort_order)
      return "completed";
    return "future";
  };

  return (
    <div className="flex items-center gap-1 px-6 py-4 overflow-x-auto">
      {stages.map((stage, i) => {
        const status = getStageStatus(stage);
        return (
          <div key={stage.id} className="flex items-center">
            <button
              onClick={() => onStageClick(stage)}
              className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-medium transition-all whitespace-nowrap ${
                status === "completed"
                  ? "bg-emerald-50 text-emerald-700 border border-emerald-200"
                  : status === "running"
                    ? "bg-blue-50 text-blue-700 border border-blue-200 animate-pulse"
                    : status === "awaiting"
                      ? "bg-purple-50 text-purple-700 border border-purple-200"
                      : status === "current"
                        ? "bg-zinc-100 text-zinc-800 border border-zinc-300"
                        : "bg-zinc-50 text-zinc-400 border border-zinc-200"
              }`}
            >
              <span
                className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold ${
                  status === "completed"
                    ? "bg-emerald-500 text-white"
                    : status === "running"
                      ? "bg-blue-500 text-white"
                      : status === "awaiting"
                        ? "bg-purple-500 text-white"
                        : status === "current"
                          ? "bg-zinc-500 text-white"
                          : "bg-zinc-200 text-zinc-500"
                }`}
              >
                {status === "completed" ? (
                  <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                  </svg>
                ) : (
                  i + 1
                )}
              </span>
              {stage.name}
            </button>
            {i < stages.length - 1 && (
              <div
                className={`w-6 h-px mx-1 ${
                  status === "completed" ? "bg-emerald-300" : "bg-zinc-200"
                }`}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}
