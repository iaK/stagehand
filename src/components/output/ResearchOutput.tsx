import { useState, useMemo, useEffect } from "react";
import { TextOutput } from "./TextOutput";
import { MarkdownTextarea } from "../ui/MarkdownTextarea";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Checkbox } from "@/components/ui/checkbox";
import { Separator } from "@/components/ui/separator";
import * as repo from "../../lib/repositories";
import { useProjectStore } from "../../stores/projectStore";
import type { ResearchQuestion, StageTemplate, StageSuggestion, CompletionStrategy } from "../../lib/types";

interface ResearchOutputProps {
  output: string;
  onApprove: () => void;
  onApproveWithStages?: (selectedStageIds: string[], completionStrategy?: CompletionStrategy) => void;
  onSubmitAnswers: (answers: string) => void;
  isApproved: boolean;
  stageTemplates?: StageTemplate[];
  approving?: boolean;
}

export function ResearchOutput({
  output,
  onApprove,
  onApproveWithStages,
  onSubmitAnswers,
  isApproved,
  stageTemplates,
  approving,
}: ResearchOutputProps) {
  let research = "";
  let questions: ResearchQuestion[] = [];
  let suggestedStages: StageSuggestion[] = [];

  try {
    const parsed = JSON.parse(output);
    research = parsed.research ?? "";
    questions = parsed.questions ?? [];
    suggestedStages = parsed.suggested_stages ?? [];
  } catch {
    return (
      <div>
        <TextOutput content={output} />
        {!isApproved && (
          <Button variant="success" onClick={onApprove} disabled={approving} className="mt-4">
            {approving ? "Approving..." : "Approve & Continue"}
          </Button>
        )}
      </div>
    );
  }

  const hasQuestions = questions.length > 0;
  const hasStageSelection = stageTemplates && stageTemplates.length > 0 && onApproveWithStages;

  return (
    <div>
      <TextOutput content={research} />

      {hasQuestions && !isApproved && (
        <QuestionCards
          questions={questions}
          onSubmit={onSubmitAnswers}
        />
      )}

      {!hasQuestions && !isApproved && hasStageSelection && (
        <StageSelectionPanel
          stageTemplates={stageTemplates}
          suggestedStages={suggestedStages}
          onApprove={onApproveWithStages}
          approving={approving}
        />
      )}

      {!hasQuestions && !isApproved && !hasStageSelection && (
        <Alert className="mt-6 border-emerald-200 bg-emerald-50 text-emerald-800">
          <AlertDescription className="text-emerald-800">
            <p className="text-sm font-medium mb-3">
              Research complete — no further questions.
            </p>
            <Button variant="success" onClick={onApprove} disabled={approving}>
              {approving ? "Approving..." : "Approve & Continue"}
            </Button>
          </AlertDescription>
        </Alert>
      )}
    </div>
  );
}

const PR_STAGE_NAMES = new Set(["pr preparation", "pr review"]);

function StageSelectionPanel({
  stageTemplates,
  suggestedStages,
  onApprove,
  approving,
}: {
  stageTemplates: StageTemplate[];
  suggestedStages: StageSuggestion[];
  onApprove: (selectedStageIds: string[], completionStrategy?: CompletionStrategy) => void;
  approving?: boolean;
}) {
  const activeProject = useProjectStore((s) => s.activeProject);
  const [completionStrategy, setCompletionStrategy] = useState<CompletionStrategy>("pr");

  // Load default completion strategy from project settings
  useEffect(() => {
    if (activeProject) {
      repo.getProjectSetting(activeProject.id, "default_completion_strategy").then((val) => {
        if (val) setCompletionStrategy(val as CompletionStrategy);
      });
    }
  }, [activeProject]);

  // Map AI suggestions to templates by normalized name
  const suggestionMap = useMemo(() => {
    const map = new Map<string, StageSuggestion>();
    for (const s of suggestedStages) {
      map.set(s.name.trim().toLowerCase(), s);
    }
    return map;
  }, [suggestedStages]);

  // Non-Research stages that can be toggled
  const selectableStages = useMemo(
    () => stageTemplates.filter((t) => t.sort_order > 0),
    [stageTemplates],
  );

  // Research stage (always included)
  const researchStage = useMemo(
    () => stageTemplates.find((t) => t.sort_order === 0),
    [stageTemplates],
  );

  // Initialize checked state: pre-check AI-suggested stages, default all if none provided/matched
  const [checked, setChecked] = useState<Record<string, boolean>>(() => {
    const initial: Record<string, boolean> = {};
    if (suggestedStages.length === 0) {
      // No suggestions at all — default to all checked
      for (const t of selectableStages) {
        initial[t.id] = true;
      }
    } else {
      for (const t of selectableStages) {
        const key = t.name.trim().toLowerCase();
        initial[t.id] = suggestionMap.has(key);
      }
      // If suggestions were provided but none matched, default to all checked
      if (!Object.values(initial).some(Boolean)) {
        for (const t of selectableStages) {
          initial[t.id] = true;
        }
      }
    }
    return initial;
  });

  // When completion strategy changes, auto-toggle PR stages
  const handleStrategyChange = (strategy: CompletionStrategy) => {
    setCompletionStrategy(strategy);
    const isPr = strategy === "pr";
    setChecked((prev) => {
      const next = { ...prev };
      for (const t of selectableStages) {
        if (PR_STAGE_NAMES.has(t.name.trim().toLowerCase())) {
          next[t.id] = isPr;
        }
      }
      return next;
    });
  };

  const handleApprove = () => {
    const selectedIds: string[] = [];
    // Always include Research
    if (researchStage) selectedIds.push(researchStage.id);
    for (const t of selectableStages) {
      if (checked[t.id]) selectedIds.push(t.id);
    }
    onApprove(selectedIds, completionStrategy);
  };

  const selectedCount = Object.values(checked).filter(Boolean).length;

  return (
    <div className="mt-6 space-y-3">
      {/* Completion strategy selector */}
      <div>
        <h3 className="text-sm font-medium text-foreground mb-1">
          How should this task be completed?
        </h3>
        <div className="flex gap-2">
          {([
            { value: "pr" as const, label: "Pull Request" },
            { value: "direct_merge" as const, label: "Direct Merge" },
            { value: "none" as const, label: "No Merge" },
          ]).map((opt) => (
            <button
              key={opt.value}
              onClick={() => handleStrategyChange(opt.value)}
              className={`px-3 py-1.5 rounded-md text-xs font-medium border transition-colors ${
                completionStrategy === opt.value
                  ? "border-blue-500 bg-blue-50 text-blue-700"
                  : "border-border text-muted-foreground hover:border-zinc-400"
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      <Separator />

      <h3 className="text-sm font-medium text-foreground">
        Pipeline stages for this task
      </h3>
      <p className="text-xs text-muted-foreground">
        The AI suggested stages based on the task. Toggle stages as needed before continuing.
      </p>

      <div className="space-y-1.5">
        {/* Research: always included */}
        {researchStage && (
          <label className="flex items-start gap-3 p-2.5 rounded-md border border-border bg-zinc-50 opacity-60 cursor-not-allowed">
            <Checkbox checked disabled className="mt-0.5" />
            <div className="flex-1 min-w-0">
              <span className="text-sm font-medium text-foreground">{researchStage.name}</span>
              <span className="text-xs text-muted-foreground ml-2">Always included</span>
            </div>
          </label>
        )}

        {/* Selectable stages */}
        {selectableStages.map((t) => {
          const key = t.name.trim().toLowerCase();
          const suggestion = suggestionMap.get(key);
          const isPrStage = PR_STAGE_NAMES.has(key);
          const dimmed = isPrStage && completionStrategy !== "pr";

          return (
            <label
              key={t.id}
              className={`flex items-start gap-3 p-2.5 rounded-md border cursor-pointer transition-colors ${
                checked[t.id]
                  ? "border-blue-500 bg-blue-50"
                  : "border-border hover:border-zinc-400"
              } ${dimmed ? "opacity-50" : ""}`}
            >
              <Checkbox
                checked={checked[t.id]}
                onCheckedChange={(v) =>
                  setChecked((prev) => ({ ...prev, [t.id]: !!v }))
                }
                className="mt-0.5"
              />
              <div className="flex-1 min-w-0">
                <span className="text-sm font-medium text-foreground">{t.name}</span>
                {suggestion && (
                  <p className="text-xs text-muted-foreground mt-0.5">{suggestion.reason}</p>
                )}
              </div>
            </label>
          );
        })}
      </div>

      <Button variant="success" onClick={handleApprove} disabled={selectedCount === 0 || approving}>
        {approving ? "Approving..." : "Approve & Continue"}
      </Button>
    </div>
  );
}

export function QuestionCards({
  questions,
  onSubmit,
  submitLabel = "Submit Answers & Continue Research",
}: {
  questions: ResearchQuestion[];
  onSubmit: (answers: string) => void | Promise<void>;
  submitLabel?: string;
}) {
  const [selections, setSelections] = useState<Record<string, string | null>>(() => {
    const initial: Record<string, string | null> = {};
    for (const q of questions) {
      if (q.options?.length) {
        const match = q.options.find((o) => o === q.proposed_answer);
        initial[q.id] = match ?? q.options[0];
      } else {
        initial[q.id] = null;
      }
    }
    return initial;
  });

  const [customText, setCustomText] = useState<Record<string, string>>(() => {
    const initial: Record<string, string> = {};
    for (const q of questions) {
      initial[q.id] = q.proposed_answer;
    }
    return initial;
  });

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async () => {
    const lines = questions.map((q) => {
      const sel = selections[q.id];
      const answer = sel !== null ? sel : (customText[q.id] ?? q.proposed_answer);
      return `Q: ${q.question}\nA: ${answer}`;
    });
    setSubmitting(true);
    setError(null);
    try {
      await onSubmit(lines.join("\n\n"));
    } catch (err) {
      console.error("Failed to submit answers:", err);
      setError(err instanceof Error ? err.message : String(err));
      setSubmitting(false);
    }
  };

  // Use a special "__other__" value to represent the "Other" option in RadioGroup
  const OTHER_VALUE = "__other__";

  return (
    <div className="mt-6 space-y-4">
      <h3 className="text-sm font-medium text-foreground">
        Questions requiring your input
      </h3>

      {questions.map((q) => {
        const currentValue = selections[q.id];
        const radioValue = currentValue === null ? OTHER_VALUE : currentValue;

        return (
          <div
            key={q.id}
            className="p-4 bg-zinc-50 border border-border rounded-lg"
          >
            <p className="text-sm text-foreground mb-3">{q.question}</p>

            {q.options && q.options.length > 0 ? (
              <RadioGroup
                value={radioValue}
                onValueChange={(value) => {
                  if (value === OTHER_VALUE) {
                    setSelections((prev) => ({ ...prev, [q.id]: null }));
                  } else {
                    setSelections((prev) => ({ ...prev, [q.id]: value }));
                  }
                }}
                className="space-y-2"
              >
                {q.options.map((option) => (
                  <label
                    key={option}
                    className={`flex items-center gap-3 p-2.5 rounded-md border cursor-pointer transition-colors ${
                      selections[q.id] === option
                        ? "border-blue-500 bg-blue-50"
                        : "border-border hover:border-zinc-400"
                    }`}
                  >
                    <RadioGroupItem value={option} />
                    <span className="text-sm text-foreground">{option}</span>
                  </label>
                ))}

                {/* "Other" option with free text */}
                <label
                  className={`flex items-start gap-3 p-2.5 rounded-md border cursor-pointer transition-colors ${
                    selections[q.id] === null
                      ? "border-blue-500 bg-blue-50"
                      : "border-border hover:border-zinc-400"
                  }`}
                >
                  <RadioGroupItem value={OTHER_VALUE} className="mt-0.5" />
                  <div className="flex-1">
                    <span className="text-sm text-muted-foreground">Other</span>
                    {selections[q.id] === null && (
                      <div
                        onMouseDown={(e) => e.stopPropagation()}
                        onClick={(e) => e.stopPropagation()}
                      >
                        <MarkdownTextarea
                          value={customText[q.id] ?? ""}
                          onChange={(v) =>
                            setCustomText((prev) => ({
                              ...prev,
                              [q.id]: v,
                            }))
                          }
                          rows={2}
                          placeholder="Type your answer..."
                          autoFocus
                          className="mt-2"
                        />
                      </div>
                    )}
                  </div>
                </label>
              </RadioGroup>
            ) : (
              <div>
                <MarkdownTextarea
                  value={customText[q.id] ?? ""}
                  onChange={(v) =>
                    setCustomText((prev) => ({
                      ...prev,
                      [q.id]: v,
                    }))
                  }
                  rows={2}
                />
                {customText[q.id] !== q.proposed_answer && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() =>
                      setCustomText((prev) => ({
                        ...prev,
                        [q.id]: q.proposed_answer,
                      }))
                    }
                    className="mt-1 text-xs text-muted-foreground"
                  >
                    Use proposed answer
                  </Button>
                )}
              </div>
            )}
          </div>
        );
      })}

      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <Button onClick={handleSubmit} disabled={submitting}>
        {submitting ? "Submitting..." : submitLabel}
      </Button>
    </div>
  );
}
