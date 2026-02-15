import type { StageTemplate, StageExecution } from "../../lib/types";
import { TextOutput } from "../output/TextOutput";
import { OptionsOutput } from "../output/OptionsOutput";
import { ChecklistOutput } from "../output/ChecklistOutput";
import { StructuredOutput } from "../output/StructuredOutput";
import { ResearchOutput } from "../output/ResearchOutput";
import { FindingsOutput } from "../output/FindingsOutput";
import { Button } from "@/components/ui/button";

interface StageOutputProps {
  execution: StageExecution;
  stage: StageTemplate;
  onApprove: (decision?: string) => void;
  onApproveWithStages?: (selectedStageIds: string[]) => void;
  onSubmitAnswers?: (answers: string) => void;
  isApproved: boolean;
  stageTemplates?: StageTemplate[];
}

export function StageOutput({
  execution,
  stage,
  onApprove,
  onApproveWithStages,
  onSubmitAnswers,
  isApproved,
  stageTemplates,
}: StageOutputProps) {
  const output = execution.parsed_output ?? execution.raw_output ?? "";

  switch (stage.output_format) {
    case "text":
      return (
        <div>
          <TextOutput content={output} />
          {!isApproved && (
            <Button
              variant="success"
              onClick={() => onApprove()}
              className="mt-4"
            >
              Approve & Continue
            </Button>
          )}
        </div>
      );

    case "options":
      return (
        <OptionsOutput
          output={output}
          onSelect={(selected) => onApprove(JSON.stringify(selected))}
          isApproved={isApproved}
        />
      );

    case "checklist":
      return (
        <ChecklistOutput
          output={output}
          onComplete={(items) => onApprove(JSON.stringify(items))}
          isApproved={isApproved}
        />
      );

    case "structured":
      return (
        <StructuredOutput
          output={output}
          stage={stage}
          onSubmit={(fields) => onApprove(JSON.stringify(fields))}
          isApproved={isApproved}
        />
      );

    case "research":
      return (
        <ResearchOutput
          output={output}
          onApprove={() => onApprove()}
          onApproveWithStages={onApproveWithStages}
          onSubmitAnswers={onSubmitAnswers ?? (() => {})}
          isApproved={isApproved}
          stageTemplates={stageTemplates}
        />
      );

    case "findings":
      // Phase 2 (attempt > 1): agent outputs text summary of applied fixes
      if (execution.attempt_number > 1) {
        return (
          <div>
            <TextOutput content={output} />
            {!isApproved && (
              <Button
                variant="success"
                onClick={() => onApprove()}
                className="mt-4"
              >
                Approve & Continue
              </Button>
            )}
          </div>
        );
      }
      // Phase 1 (attempt 1): render selectable findings
      return (
        <FindingsOutput
          output={output}
          onApplySelected={(selectedText) => {
            if (onSubmitAnswers) {
              onSubmitAnswers(selectedText);
            }
          }}
          onSkipAll={() => onApprove()}
          isApproved={isApproved}
        />
      );

    default:
      return <TextOutput content={output} />;
  }
}
