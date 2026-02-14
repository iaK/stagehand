import { useRef, useEffect, useState } from "react";
import type { StageExecution, StageTemplate } from "../../lib/types";
import { TextOutput } from "../output/TextOutput";

// ── Shared bubble primitives ──

export function UserBubble({
  text,
  label,
}: {
  text: string;
  label: string;
}) {
  return (
    <div className="flex gap-3 items-start">
      <div className="relative z-10 w-6 h-6 rounded-full bg-blue-600 flex items-center justify-center flex-shrink-0 mt-0.5">
        <svg className="w-3 h-3 text-white" fill="currentColor" viewBox="0 0 20 20">
          <path d="M10 9a3 3 0 100-6 3 3 0 000 6zm-7 9a7 7 0 1114 0H3z" />
        </svg>
      </div>
      <div className="flex-1 min-w-0 pb-4">
        <p className="text-xs text-zinc-500 mb-1">{label}</p>
        <div className="p-3 bg-zinc-900/50 border border-zinc-800 rounded-lg">
          <p className="text-sm text-zinc-300 whitespace-pre-wrap">{text}</p>
        </div>
      </div>
    </div>
  );
}

export function AiBubble({
  children,
  label,
}: {
  children: React.ReactNode;
  label: string;
}) {
  return (
    <div className="flex gap-3 items-start">
      <div className="relative z-10 w-6 h-6 rounded-full bg-zinc-700 flex items-center justify-center flex-shrink-0 mt-0.5">
        <svg className="w-3 h-3 text-zinc-300" fill="currentColor" viewBox="0 0 20 20">
          <path fillRule="evenodd" d="M11.3 1.046A1 1 0 0112 2v5h4a1 1 0 01.82 1.573l-7 10A1 1 0 018 18v-5H4a1 1 0 01-.82-1.573l7-10a1 1 0 011.12-.38z" clipRule="evenodd" />
        </svg>
      </div>
      <div className="flex-1 min-w-0 pb-4">
        <p className="text-xs text-zinc-500 mb-1">{label}</p>
        <div className="border border-zinc-800 rounded-lg overflow-hidden">
          {children}
        </div>
      </div>
    </div>
  );
}

export function LiveStreamBubble({
  streamLines,
  label,
  onStop,
}: {
  streamLines: string[];
  label: string;
  onStop: () => void;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) {
      el.scrollTop = el.scrollHeight;
    }
  }, [streamLines.length]);

  const text = streamLines.join("");

  return (
    <div className="flex gap-3 items-start">
      <div className="relative z-10 w-6 h-6 rounded-full bg-zinc-700 flex items-center justify-center flex-shrink-0 mt-0.5">
        <div className="w-2.5 h-2.5 rounded-full bg-blue-400 animate-pulse" />
      </div>
      <div className="flex-1 min-w-0 pb-4">
        <div className="flex items-center gap-2 mb-1">
          <p className="text-xs text-blue-400">{label}</p>
          <button
            type="button"
            onClick={onStop}
            className="text-xs text-red-400 hover:text-red-300 transition-colors"
          >
            Stop
          </button>
        </div>
        <div className="border border-zinc-800 rounded-lg overflow-hidden bg-zinc-950">
          <div
            ref={scrollRef}
            className="p-3 max-h-80 overflow-y-auto text-sm text-zinc-400 font-mono whitespace-pre-wrap"
          >
            {text || "Starting..."}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Thinking Bubble ──

export function ThinkingBubble({
  text,
  label = "AI thinking process",
}: {
  text: string;
  label?: string;
}) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="flex gap-3 items-start">
      <div className="relative z-10 w-6 h-6 rounded-full bg-zinc-800 flex items-center justify-center flex-shrink-0 mt-0.5">
        <svg className="w-3 h-3 text-zinc-500" fill="currentColor" viewBox="0 0 20 20">
          <path d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" />
        </svg>
      </div>
      <div className="flex-1 min-w-0 pb-4">
        <button
          onClick={() => setExpanded(!expanded)}
          className="flex items-center gap-1.5 text-xs text-zinc-500 hover:text-zinc-300 transition-colors mb-1"
        >
          <svg
            className={`w-3 h-3 transition-transform ${expanded ? "rotate-90" : ""}`}
            fill="currentColor"
            viewBox="0 0 20 20"
          >
            <path fillRule="evenodd" d="M7.293 14.707a1 1 0 010-1.414L10.586 10 7.293 6.707a1 1 0 011.414-1.414l4 4a1 1 0 010 1.414l-4 4a1 1 0 01-1.414 0z" clipRule="evenodd" />
          </svg>
          {label}
        </button>
        {expanded && (
          <div className="border border-zinc-800 rounded-lg overflow-hidden bg-zinc-950">
            <div className="p-3 max-h-60 overflow-y-auto text-xs text-zinc-500 font-mono whitespace-pre-wrap">
              {text}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Timeline (completed rounds) ──

interface StageTimelineProps {
  executions: StageExecution[];
  stage: StageTemplate;
}

export function StageTimeline({ executions, stage }: StageTimelineProps) {
  if (executions.length === 0) return null;

  return (
    <div className="relative">
      <div className="absolute left-3 top-3 bottom-3 w-px bg-zinc-800" />
      <div className="space-y-1">
        {executions.map((exec) => (
          <TimelineEntry key={exec.id} execution={exec} stage={stage} />
        ))}
      </div>
    </div>
  );
}

function TimelineEntry({
  execution,
  stage,
}: {
  execution: StageExecution;
  stage: StageTemplate;
}) {
  const userInput = execution.user_input;
  const output = execution.parsed_output ?? execution.raw_output ?? "";
  const isFirst = execution.attempt_number === 1;

  return (
    <>
      {userInput && (
        <UserBubble
          text={userInput}
          label={`${isFirst ? "Your input" : "Your answers"} #${execution.attempt_number}`}
        />
      )}

      {execution.thinking_output && (
        <ThinkingBubble
          text={execution.thinking_output}
          label={`Thinking #${execution.attempt_number}`}
        />
      )}

      {output && execution.status !== "running" && execution.status !== "pending" && (
        <AiBubble label={`${stage.name} response #${execution.attempt_number}`}>
          <TimelineOutput output={output} stage={stage} />
        </AiBubble>
      )}
    </>
  );
}

function TimelineOutput({
  output,
  stage,
}: {
  output: string;
  stage: StageTemplate;
}) {
  if (stage.output_format === "research") {
    try {
      const parsed = JSON.parse(output);
      const research: string = parsed.research ?? "";
      const questions: { id: string; question: string; proposed_answer: string }[] =
        parsed.questions ?? [];

      return (
        <div className="p-3">
          <div className="text-sm">
            <TextOutput content={research} />
          </div>
          {questions.length > 0 && (
            <div className="mt-3 pt-3 border-t border-zinc-800 space-y-2">
              <p className="text-xs text-zinc-500">Questions asked ({questions.length})</p>
              {questions.map((q) => (
                <div key={q.id} className="text-xs text-zinc-400">
                  <span className="text-zinc-300">Q: </span>{q.question}
                </div>
              ))}
            </div>
          )}
        </div>
      );
    } catch {
      // fall through to text
    }
  }

  return (
    <div className="p-3 text-sm">
      <TextOutput content={output} />
    </div>
  );
}
