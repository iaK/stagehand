import { useState } from "react";
import { useTaskStore } from "../../stores/taskStore";
import { TextOutput } from "../output/TextOutput";

export function StageHistory() {
  const { stageTemplates, executions } = useTaskStore();
  const [expandedStage, setExpandedStage] = useState<string | null>(null);

  const completedStages = stageTemplates.filter((stage) =>
    executions.some(
      (e) => e.stage_template_id === stage.id && e.status === "approved",
    ),
  );

  if (completedStages.length === 0) {
    return (
      <div className="w-80 border-l border-zinc-800 bg-zinc-900 p-4">
        <h3 className="text-sm font-medium text-zinc-400 mb-3">
          Completed Stages
        </h3>
        <p className="text-xs text-zinc-600 italic">
          No completed stages yet
        </p>
      </div>
    );
  }

  return (
    <div className="w-80 border-l border-zinc-800 bg-zinc-900 flex flex-col overflow-y-auto">
      <div className="p-4 border-b border-zinc-800">
        <h3 className="text-sm font-medium text-zinc-400">
          Completed Stages
        </h3>
      </div>
      <div className="flex-1 overflow-y-auto">
        {completedStages.map((stage) => {
          const latestApproved = executions
            .filter(
              (e) =>
                e.stage_template_id === stage.id && e.status === "approved",
            )
            .sort((a, b) => b.attempt_number - a.attempt_number)[0];

          const isExpanded = expandedStage === stage.id;

          return (
            <div key={stage.id} className="border-b border-zinc-800">
              <button
                onClick={() =>
                  setExpandedStage(isExpanded ? null : stage.id)
                }
                className="w-full text-left px-4 py-3 hover:bg-zinc-800/50 transition-colors"
              >
                <div className="flex items-center justify-between">
                  <span className="text-sm text-zinc-300">{stage.name}</span>
                  <span className="text-xs text-zinc-600">
                    {isExpanded ? "▼" : "▶"}
                  </span>
                </div>
                {!isExpanded && latestApproved?.parsed_output && (
                  <p className="text-xs text-zinc-600 mt-1 line-clamp-2">
                    {latestApproved.parsed_output.slice(0, 120)}...
                  </p>
                )}
              </button>
              {isExpanded && latestApproved?.parsed_output && (
                <div className="px-4 pb-4 max-h-96 overflow-y-auto">
                  <TextOutput content={latestApproved.parsed_output} />
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
