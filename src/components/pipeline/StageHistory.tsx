import { useState } from "react";
import { useTaskStore } from "../../stores/taskStore";
import { TextOutput } from "../output/TextOutput";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from "@/components/ui/collapsible";

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
      <div className="w-80 border-l border-border bg-muted/30 p-4">
        <h3 className="text-sm font-medium text-muted-foreground mb-3">
          Completed Stages
        </h3>
        <p className="text-xs text-muted-foreground italic">
          No completed stages yet
        </p>
      </div>
    );
  }

  return (
    <div className="w-80 border-l border-border bg-muted/30 flex flex-col">
      <div className="p-4 border-b border-border">
        <h3 className="text-sm font-medium text-muted-foreground">
          Completed Stages
        </h3>
      </div>
      <ScrollArea className="flex-1">
        {completedStages.map((stage) => {
          const latestApproved = executions
            .filter(
              (e) =>
                e.stage_template_id === stage.id && e.status === "approved",
            )
            .sort((a, b) => b.attempt_number - a.attempt_number)[0];

          const isExpanded = expandedStage === stage.id;

          return (
            <Collapsible
              key={stage.id}
              open={isExpanded}
              onOpenChange={(open) => setExpandedStage(open ? stage.id : null)}
            >
              <div className="border-b border-border">
                <CollapsibleTrigger className="w-full text-left px-4 py-3 hover:bg-accent/50 transition-colors">
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-foreground">{stage.name}</span>
                    <span className="text-xs text-muted-foreground">
                      {isExpanded ? "\u25BC" : "\u25B6"}
                    </span>
                  </div>
                  {!isExpanded && latestApproved?.parsed_output && (
                    <p className="text-xs text-muted-foreground mt-1 line-clamp-2">
                      {latestApproved.parsed_output.slice(0, 120)}...
                    </p>
                  )}
                </CollapsibleTrigger>
                <CollapsibleContent>
                  {latestApproved?.parsed_output && (
                    <div className="px-4 pb-4 max-h-96 overflow-y-auto">
                      <TextOutput content={latestApproved.parsed_output} />
                    </div>
                  )}
                </CollapsibleContent>
              </div>
            </Collapsible>
          );
        })}
      </ScrollArea>
    </div>
  );
}
