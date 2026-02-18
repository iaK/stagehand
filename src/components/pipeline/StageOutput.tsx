import { useMemo } from "react";
import type { StageTemplate, StageExecution, ResearchQuestion } from "../../lib/types";
import { detectInteractionType } from "../../lib/outputDetection";
import { TextOutput } from "../output/TextOutput";
import { OptionsOutput } from "../output/OptionsOutput";
import { ChecklistOutput } from "../output/ChecklistOutput";
import { StructuredOutput } from "../output/StructuredOutput";
import { ResearchOutput, QuestionCards } from "../output/ResearchOutput";
import { FindingsOutput } from "../output/FindingsOutput";
import { Button } from "@/components/ui/button";
import { Loader2 } from "lucide-react";

interface StageOutputProps {
  execution: StageExecution;
  stage: StageTemplate;
  onApprove: (decision?: string) => void;
  onApproveWithStages?: (selectedStageIds: string[]) => void;
  onSubmitAnswers?: (answers: string) => void;
  isApproved: boolean;
  stageTemplates?: StageTemplate[];
  approving?: boolean;
  isCommitEligible?: boolean;
}

export function StageOutput({
  execution,
  stage,
  onApprove,
  onApproveWithStages,
  onSubmitAnswers,
  isApproved,
  stageTemplates,
  approving,
  isCommitEligible,
}: StageOutputProps) {
  const output = execution.parsed_output ?? execution.raw_output ?? "";

  // Resolve the effective format: for "auto", detect from content; otherwise use the explicit format
  const effectiveFormat = useMemo(
    () => detectInteractionType(output, stage.output_format),
    [output, stage.output_format],
  );

  switch (effectiveFormat) {
    case "text":
      return (
        <div>
          <TextOutput content={output} />
          {!isCommitEligible && !isApproved && (
            <Button
              variant="success"
              onClick={() => onApprove()}
              disabled={approving}
              className="mt-4"
            >
              {approving && <Loader2 className="w-4 h-4 animate-spin" />}
              {approving ? "Approving..." : "Approve & Continue"}
            </Button>
          )}
        </div>
      );

    case "options": {
      // Check for questions before rendering options
      try {
        const parsed = JSON.parse(output);
        const questions: ResearchQuestion[] = parsed.questions ?? [];
        if (questions.length > 0 && !isApproved && onSubmitAnswers) {
          return (
            <QuestionCards
              questions={questions}
              onSubmit={onSubmitAnswers}
              submitLabel="Submit Answers"
            />
          );
        }
      } catch {
        // Not valid JSON, fall through to normal options rendering
      }
      return (
        <OptionsOutput
          output={output}
          onSelect={(selected) => onApprove(JSON.stringify(selected))}
          isApproved={isApproved}
          approving={approving}
        />
      );
    }

    case "checklist":
      return (
        <ChecklistOutput
          output={output}
          onComplete={(items) => onApprove(JSON.stringify(items))}
          isApproved={isApproved}
          approving={approving}
        />
      );

    case "structured":
      return (
        <StructuredOutput
          output={output}
          stage={stage}
          onSubmit={(fields) => onApprove(JSON.stringify(fields))}
          isApproved={isApproved}
          approving={approving}
        />
      );

    case "plan": {
      let planContent = output;
      try {
        const parsed = JSON.parse(output);
        const questions: ResearchQuestion[] = parsed.questions ?? [];
        if (questions.length > 0 && !isApproved && onSubmitAnswers) {
          return (
            <div>
              {parsed.plan && <TextOutput content={parsed.plan} />}
              <QuestionCards
                questions={questions}
                onSubmit={onSubmitAnswers}
                submitLabel="Submit Answers"
              />
            </div>
          );
        }
        planContent = parsed.plan ?? output;
      } catch {
        // Not valid JSON, render as plain text
      }
      return (
        <div>
          <TextOutput content={planContent} />
          {!isApproved && (
            <Button
              variant="success"
              onClick={() => onApprove()}
              disabled={approving}
              className="mt-4"
            >
              {approving && <Loader2 className="w-4 h-4 animate-spin" />}
              {approving ? "Approving..." : "Approve & Continue"}
            </Button>
          )}
        </div>
      );
    }

    case "research":
      return (
        <ResearchOutput
          output={output}
          onApprove={() => onApprove()}
          onApproveWithStages={onApproveWithStages}
          onSubmitAnswers={onSubmitAnswers ?? (() => {})}
          isApproved={isApproved}
          stageTemplates={stageTemplates}
          approving={approving}
        />
      );

    case "findings": {
      // Detect Phase 1 (JSON findings) vs Phase 2 (text summary) from content,
      // not attempt_number — a redo can re-run Phase 1 at attempt > 1.
      let isFindingsJson = false;
      try {
        const parsed = JSON.parse(output);
        if (parsed.findings && Array.isArray(parsed.findings)) {
          isFindingsJson = true;
        }
      } catch { /* not JSON — Phase 2 text */ }

      if (!isFindingsJson) {
        // Phase 2: text summary of applied fixes
        return (
          <div>
            <TextOutput content={output} />
            {!isCommitEligible && !isApproved && (
              <Button
                variant="success"
                onClick={() => onApprove()}
                disabled={approving}
                className="mt-4"
              >
                {approving && <Loader2 className="w-4 h-4 animate-spin" />}
                {approving ? "Approving..." : "Approve & Continue"}
              </Button>
            )}
          </div>
        );
      }
      // Phase 1: render selectable findings
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
          approving={approving}
        />
      );
    }

    case "pr_review":
      return isApproved ? (
        <div>
          <TextOutput content={output || "PR Review completed."} />
        </div>
      ) : null;

    case "merge":
      return isApproved ? (
        <div>
          <TextOutput content={output || "Branch merged successfully."} />
        </div>
      ) : null;

    default:
      return <TextOutput content={output} />;
  }
}
