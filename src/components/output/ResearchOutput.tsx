import { useState } from "react";
import { TextOutput } from "./TextOutput";
import { MarkdownTextarea } from "../ui/MarkdownTextarea";
import type { ResearchQuestion } from "../../lib/types";

interface ResearchOutputProps {
  output: string;
  onApprove: () => void;
  onSubmitAnswers: (answers: string) => void;
  isApproved: boolean;
}

export function ResearchOutput({
  output,
  onApprove,
  onSubmitAnswers,
  isApproved,
}: ResearchOutputProps) {
  let research = "";
  let questions: ResearchQuestion[] = [];

  try {
    const parsed = JSON.parse(output);
    research = parsed.research ?? "";
    questions = parsed.questions ?? [];
  } catch {
    // JSON parse failed — render raw output as text
    return (
      <div>
        <TextOutput content={output} />
        {!isApproved && (
          <button
            onClick={onApprove}
            className="mt-4 px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg text-sm font-medium transition-colors"
          >
            Approve & Continue
          </button>
        )}
      </div>
    );
  }

  const hasQuestions = questions.length > 0;

  return (
    <div>
      <TextOutput content={research} />

      {hasQuestions && !isApproved && (
        <QuestionCards
          questions={questions}
          onSubmit={onSubmitAnswers}
        />
      )}

      {!hasQuestions && !isApproved && (
        <div className="mt-6 p-4 bg-emerald-950/30 border border-emerald-800 rounded-lg">
          <p className="text-sm text-emerald-300 font-medium mb-3">
            Research complete — no further questions.
          </p>
          <button
            onClick={onApprove}
            className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg text-sm font-medium transition-colors"
          >
            Approve & Continue
          </button>
        </div>
      )}
    </div>
  );
}

function QuestionCards({
  questions,
  onSubmit,
}: {
  questions: ResearchQuestion[];
  onSubmit: (answers: string) => void;
}) {
  // Track selected option per question: option text or null for "Other"
  const [selections, setSelections] = useState<Record<string, string | null>>(() => {
    const initial: Record<string, string | null> = {};
    for (const q of questions) {
      if (q.options?.length) {
        // Pre-select option matching proposed_answer, or first option
        const match = q.options.find((o) => o === q.proposed_answer);
        initial[q.id] = match ?? q.options[0];
      } else {
        initial[q.id] = null; // free text mode
      }
    }
    return initial;
  });

  // Track custom text for "Other"
  const [customText, setCustomText] = useState<Record<string, string>>(() => {
    const initial: Record<string, string> = {};
    for (const q of questions) {
      initial[q.id] = q.proposed_answer;
    }
    return initial;
  });

  const handleSubmit = () => {
    const lines = questions.map((q) => {
      const sel = selections[q.id];
      const answer = sel !== null ? sel : (customText[q.id] ?? q.proposed_answer);
      return `Q: ${q.question}\nA: ${answer}`;
    });
    onSubmit(lines.join("\n\n"));
  };

  return (
    <div className="mt-6 space-y-4">
      <h3 className="text-sm font-medium text-zinc-300">
        Questions requiring your input
      </h3>

      {questions.map((q) => (
        <div
          key={q.id}
          className="p-4 bg-zinc-900 border border-zinc-700 rounded-lg"
        >
          <p className="text-sm text-zinc-200 mb-3">{q.question}</p>

          {q.options && q.options.length > 0 ? (
            <div className="space-y-2">
              {q.options.map((option) => (
                <label
                  key={option}
                  className={`flex items-center gap-3 p-2.5 rounded-md border cursor-pointer transition-colors ${
                    selections[q.id] === option
                      ? "border-blue-500 bg-blue-950/30"
                      : "border-zinc-700 hover:border-zinc-600"
                  }`}
                >
                  <input
                    type="radio"
                    name={`question-${q.id}`}
                    checked={selections[q.id] === option}
                    onChange={() =>
                      setSelections((prev) => ({ ...prev, [q.id]: option }))
                    }
                    className="text-blue-500 focus:ring-blue-500 bg-zinc-800 border-zinc-600"
                  />
                  <span className="text-sm text-zinc-200">{option}</span>
                </label>
              ))}

              {/* "Other" option with free text */}
              <label
                className={`flex items-start gap-3 p-2.5 rounded-md border cursor-pointer transition-colors ${
                  selections[q.id] === null
                    ? "border-blue-500 bg-blue-950/30"
                    : "border-zinc-700 hover:border-zinc-600"
                }`}
              >
                <input
                  type="radio"
                  name={`question-${q.id}`}
                  checked={selections[q.id] === null}
                  onChange={() =>
                    setSelections((prev) => ({ ...prev, [q.id]: null }))
                  }
                  className="mt-0.5 text-blue-500 focus:ring-blue-500 bg-zinc-800 border-zinc-600"
                />
                <div className="flex-1">
                  <span className="text-sm text-zinc-400">Other</span>
                  {selections[q.id] === null && (
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
                  )}
                </div>
              </label>
            </div>
          ) : (
            /* Fallback: free text only (backward compat for questions without options) */
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
                <button
                  onClick={() =>
                    setCustomText((prev) => ({
                      ...prev,
                      [q.id]: q.proposed_answer,
                    }))
                  }
                  className="mt-1 text-xs text-zinc-500 hover:text-zinc-300 transition-colors"
                >
                  Use proposed answer
                </button>
              )}
            </div>
          )}
        </div>
      ))}

      <button
        onClick={handleSubmit}
        className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-sm font-medium transition-colors"
      >
        Submit Answers & Continue Research
      </button>
    </div>
  );
}
