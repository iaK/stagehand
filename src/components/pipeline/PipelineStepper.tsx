import type { StageTemplate, StageExecution } from "../../lib/types";

interface PipelineStepperProps {
  stages: StageTemplate[];
  currentStageId: string | null;
  executions: StageExecution[];
  onStageClick: (stage: StageTemplate) => void;
}

export function PipelineStepper({
  stages,
  currentStageId,
  executions,
  onStageClick,
}: PipelineStepperProps) {
  const getStageStatus = (stage: StageTemplate) => {
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
                  ? "bg-emerald-900/40 text-emerald-400 border border-emerald-800"
                  : status === "running"
                    ? "bg-blue-900/40 text-blue-400 border border-blue-700 animate-pulse"
                    : status === "awaiting"
                      ? "bg-amber-900/40 text-amber-400 border border-amber-700"
                      : status === "current"
                        ? "bg-zinc-700 text-zinc-200 border border-zinc-600"
                        : "bg-zinc-900 text-zinc-600 border border-zinc-800"
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
                          : "bg-zinc-800 text-zinc-600"
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
                  status === "completed" ? "bg-emerald-700" : "bg-zinc-800"
                }`}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}
