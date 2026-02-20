import { useRef, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from "@/components/ui/collapsible";
import { ScrollArea } from "@/components/ui/scroll-area";
import type { StageExecution, StageTemplate } from "../../lib/types";
import { TextOutput } from "../output/TextOutput";

// -- Collapsible input bubble (for "Input from previous stage") --

export function CollapsibleInputBubble({
  text,
  label,
}: {
  text: string;
  label: string;
}) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="flex gap-3 items-start">
      <div className="relative z-10 w-6 h-6 rounded-full bg-blue-600 dark:bg-blue-500 flex items-center justify-center flex-shrink-0 mt-0.5">
        <svg className="w-3 h-3 text-white" fill="currentColor" viewBox="0 0 20 20">
          <path d="M10 9a3 3 0 100-6 3 3 0 000 6zm-7 9a7 7 0 1114 0H3z" />
        </svg>
      </div>
      <Collapsible open={expanded} onOpenChange={setExpanded} className="flex-1 min-w-0 pb-4 pt-0.5">
        <CollapsibleTrigger className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors cursor-pointer">
          <svg
            className={`w-3 h-3 transition-transform ${expanded ? "rotate-90" : ""}`}
            fill="currentColor"
            viewBox="0 0 20 20"
          >
            <path fillRule="evenodd" d="M7.293 14.707a1 1 0 010-1.414L10.586 10 7.293 6.707a1 1 0 011.414-1.414l4 4a1 1 0 010 1.414l-4 4a1 1 0 01-1.414 0z" clipRule="evenodd" />
          </svg>
          {label}
        </CollapsibleTrigger>
        <CollapsibleContent>
          <div className="mt-1 p-3 bg-zinc-50 dark:bg-zinc-900 border border-border rounded-lg text-sm text-zinc-700 dark:text-zinc-300">
            <TextOutput content={text} />
          </div>
        </CollapsibleContent>
      </Collapsible>
    </div>
  );
}

// -- Shared bubble primitives --

export function UserBubble({
  text,
  label,
}: {
  text: string;
  label: string;
}) {
  return (
    <div className="flex gap-3 items-start">
      <div className="relative z-10 w-6 h-6 rounded-full bg-blue-600 dark:bg-blue-500 flex items-center justify-center flex-shrink-0 mt-0.5">
        <svg className="w-3 h-3 text-white" fill="currentColor" viewBox="0 0 20 20">
          <path d="M10 9a3 3 0 100-6 3 3 0 000 6zm-7 9a7 7 0 1114 0H3z" />
        </svg>
      </div>
      <div className="flex-1 min-w-0 pb-4">
        <p className="text-xs text-muted-foreground mb-1">{label}</p>
        <div className="p-3 bg-zinc-50 dark:bg-zinc-900 border border-border rounded-lg">
          <p className="text-sm text-zinc-700 dark:text-zinc-300 whitespace-pre-wrap">{text}</p>
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
      <div className="relative z-10 w-6 h-6 rounded-full bg-zinc-200 dark:bg-zinc-700 flex items-center justify-center flex-shrink-0 mt-0.5">
        <svg className="w-3 h-3 text-zinc-600 dark:text-zinc-400" fill="currentColor" viewBox="0 0 20 20">
          <path fillRule="evenodd" d="M11.3 1.046A1 1 0 0112 2v5h4a1 1 0 01.82 1.573l-7 10A1 1 0 018 18v-5H4a1 1 0 01-.82-1.573l7-10a1 1 0 011.12-.38z" clipRule="evenodd" />
        </svg>
      </div>
      <div className="flex-1 min-w-0 pb-4">
        <p className="text-xs text-muted-foreground mb-1">{label}</p>
        <div className="border border-border rounded-lg overflow-hidden">
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
  isStopping = false,
}: {
  streamLines: string[];
  label: string;
  onStop: () => void;
  isStopping?: boolean;
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
      <div className="relative z-10 w-6 h-6 rounded-full bg-zinc-200 dark:bg-zinc-700 flex items-center justify-center flex-shrink-0 mt-0.5">
        <div className={`w-2.5 h-2.5 rounded-full ${isStopping ? "bg-amber-500" : "bg-blue-500"} animate-pulse`} />
      </div>
      <div className="flex-1 min-w-0 pb-4">
        <div className="flex items-center gap-2 mb-1">
          <p className={`text-xs ${isStopping ? "text-amber-600 dark:text-amber-400" : "text-blue-600 dark:text-blue-400"}`}>
            {isStopping ? "Stopping..." : label}
          </p>
          {!isStopping && (
            <Button
              variant="ghost"
              size="xs"
              onClick={onStop}
              className="text-destructive hover:text-destructive"
            >
              Stop
            </Button>
          )}
        </div>
        <div className="border border-border rounded-lg overflow-hidden bg-zinc-50 dark:bg-zinc-900">
          <div
            ref={scrollRef}
            className="p-3 max-h-80 overflow-y-auto text-sm text-zinc-600 dark:text-zinc-400 font-mono whitespace-pre-wrap"
          >
            {text || "Starting..."}
          </div>
        </div>
      </div>
    </div>
  );
}

// -- Thinking Bubble --

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
      <div className="relative z-10 w-6 h-6 rounded-full bg-zinc-100 dark:bg-zinc-800 flex items-center justify-center flex-shrink-0">
        <svg className="w-3 h-3 text-muted-foreground" fill="currentColor" viewBox="0 0 20 20">
          <path d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" />
        </svg>
      </div>
      <Collapsible open={expanded} onOpenChange={setExpanded} className="flex-1 min-w-0 pb-4 pt-1">
        <CollapsibleTrigger className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors mb-1">
          <svg
            className={`w-3 h-3 transition-transform ${expanded ? "rotate-90" : ""}`}
            fill="currentColor"
            viewBox="0 0 20 20"
          >
            <path fillRule="evenodd" d="M7.293 14.707a1 1 0 010-1.414L10.586 10 7.293 6.707a1 1 0 011.414-1.414l4 4a1 1 0 010 1.414l-4 4a1 1 0 01-1.414 0z" clipRule="evenodd" />
          </svg>
          {label}
        </CollapsibleTrigger>
        <CollapsibleContent>
          <div className="border border-border rounded-lg overflow-hidden bg-zinc-50 dark:bg-zinc-900">
            <ScrollArea className="max-h-60">
              <div className="p-3 text-xs text-muted-foreground font-mono whitespace-pre-wrap">
                {text}
              </div>
            </ScrollArea>
          </div>
        </CollapsibleContent>
      </Collapsible>
    </div>
  );
}

// -- Timeline (completed rounds) --

interface StageTimelineProps {
  executions: StageExecution[];
  stage: StageTemplate;
}

export function StageTimeline({ executions, stage }: StageTimelineProps) {
  const [forceState, setForceState] = useState<boolean | null>(null);

  if (executions.length === 0) return null;

  return (
    <div className="relative">
      {executions.length > 1 && (
        <div className="flex justify-end mb-2">
          <Button
            variant="ghost"
            size="xs"
            onClick={() => setForceState(prev => prev === true ? false : true)}
            className="text-xs text-muted-foreground"
          >
            {forceState === true ? "Collapse All" : "Expand All"}
          </Button>
        </div>
      )}
      <div className="absolute left-3 top-3 bottom-3 w-px bg-border" />
      <div className="space-y-1">
        {executions.map((exec) => (
          <CollapsibleTimelineEntry
            key={exec.id}
            execution={exec}
            stage={stage}
            forceExpanded={forceState}
            onManualToggle={() => setForceState(null)}
          />
        ))}
      </div>
    </div>
  );
}

function CollapsibleTimelineEntry({
  execution,
  stage,
  forceExpanded,
  onManualToggle,
}: {
  execution: StageExecution;
  stage: StageTemplate;
  forceExpanded?: boolean | null;
  onManualToggle?: () => void;
}) {
  const [localExpanded, setLocalExpanded] = useState(false);
  const expanded = forceExpanded ?? localExpanded;

  const handleToggle = (open: boolean) => {
    setLocalExpanded(open);
    if (onManualToggle) onManualToggle();
  };

  const output = execution.parsed_output ?? execution.raw_output ?? "";
  const hasOutput = output && execution.status !== "running" && execution.status !== "pending";

  return (
    <div className="flex gap-3 items-start">
      <div className="relative z-10 w-6 h-6 rounded-full bg-zinc-200 dark:bg-zinc-700 flex items-center justify-center flex-shrink-0 mt-0.5">
        <svg className="w-3 h-3 text-zinc-600 dark:text-zinc-400" fill="currentColor" viewBox="0 0 20 20">
          <path fillRule="evenodd" d="M11.3 1.046A1 1 0 0112 2v5h4a1 1 0 01.82 1.573l-7 10A1 1 0 018 18v-5H4a1 1 0 01-.82-1.573l7-10a1 1 0 011.12-.38z" clipRule="evenodd" />
        </svg>
      </div>
      <Collapsible open={expanded} onOpenChange={handleToggle} className="flex-1 min-w-0 pb-4 pt-0.5">
        <CollapsibleTrigger className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors cursor-pointer">
          <svg
            className={`w-3 h-3 transition-transform ${expanded ? "rotate-90" : ""}`}
            fill="currentColor"
            viewBox="0 0 20 20"
          >
            <path fillRule="evenodd" d="M7.293 14.707a1 1 0 010-1.414L10.586 10 7.293 6.707a1 1 0 011.414-1.414l4 4a1 1 0 010 1.414l-4 4a1 1 0 01-1.414 0z" clipRule="evenodd" />
          </svg>
          {stage.name} round #{execution.attempt_number}
          {execution.status === "approved" && (
            <span className="text-emerald-600 dark:text-emerald-400 ml-1">&#10003;</span>
          )}
        </CollapsibleTrigger>
        <CollapsibleContent>
          <div className="mt-2 space-y-1">
            {execution.user_input && (
              <CollapsibleInputBubble
                text={execution.user_input}
                label={
                  !stage.requires_user_input
                    ? `Input from previous stage #${execution.attempt_number}`
                    : `${execution.attempt_number === 1 ? "Your input" : "Your answers"} #${execution.attempt_number}`
                }
              />
            )}

            {execution.thinking_output && (
              <ThinkingBubble
                text={execution.thinking_output}
                label={`Thinking #${execution.attempt_number}`}
              />
            )}

            {hasOutput && (
              <AiBubble label={`${stage.name} response #${execution.attempt_number}`}>
                <TimelineOutput output={output} stage={stage} />
              </AiBubble>
            )}
          </div>
        </CollapsibleContent>
      </Collapsible>
    </div>
  );
}

function TimelineOutput({
  output,
  stage,
}: {
  output: string;
  stage: StageTemplate;
}) {
  if (stage.output_format === "research" || stage.output_format === "plan" || stage.output_format === "options") {
    try {
      const parsed = JSON.parse(output);
      const content: string = parsed.research ?? parsed.plan ?? "";
      const questions: { id: string; question: string; proposed_answer: string }[] =
        parsed.questions ?? [];

      if (content || questions.length > 0) {
        return (
          <div className="p-3">
            {content && (
              <div className="text-sm">
                <TextOutput content={content} />
              </div>
            )}
            {questions.length > 0 && (
              <div className="mt-3 pt-3 border-t border-border space-y-2">
                <p className="text-xs text-muted-foreground">Questions asked ({questions.length})</p>
                {questions.map((q) => (
                  <div key={q.id} className="text-xs text-zinc-600 dark:text-zinc-400">
                    <span className="text-foreground">Q: </span>{q.question}
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      }
    } catch {
      // fall through to text
    }
  }

  // Findings: extract summary from JSON instead of showing raw JSON
  if (stage.output_format === "findings") {
    try {
      const parsed = JSON.parse(output);
      if (parsed.summary) {
        return (
          <div className="p-3 text-sm">
            <TextOutput content={parsed.summary} />
            {parsed.findings?.length > 0 && (
              <p className="mt-2 text-xs text-muted-foreground">
                {parsed.findings.length} finding{parsed.findings.length !== 1 ? "s" : ""} identified
              </p>
            )}
          </div>
        );
      }
    } catch {
      // Not JSON -- Phase 2 text output, fall through
    }
  }

  return (
    <div className="p-3 text-sm">
      <TextOutput content={output} />
    </div>
  );
}
