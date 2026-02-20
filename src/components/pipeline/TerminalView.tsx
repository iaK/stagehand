import { useRef, useEffect, useState } from "react";
import { useProcessStore, DEFAULT_STAGE_STATE } from "../../stores/processStore";
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from "@/components/ui/collapsible";

export function TerminalView() {
  const viewingStageId = useProcessStore((s) => s.viewingStageId);
  const { streamOutput, isRunning } = useProcessStore(
    (s) => (viewingStageId ? s.stages[viewingStageId] ?? DEFAULT_STAGE_STATE : DEFAULT_STAGE_STATE),
  );
  const anyRunning = useProcessStore((s) =>
    Object.values(s.stages).some((st) => st.isRunning),
  );
  const scrollRef = useRef<HTMLDivElement>(null);
  const [collapsed, setCollapsed] = useState(false);

  // Auto-scroll
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [streamOutput]);

  // Auto-expand when any process starts
  useEffect(() => {
    if (isRunning) setCollapsed(false);
  }, [isRunning]);

  return (
    <Collapsible open={!collapsed} onOpenChange={(open) => setCollapsed(!open)}>
      <div
        className={`border-t border-border bg-zinc-50 dark:bg-zinc-900 flex flex-col transition-all ${
          collapsed ? "h-8" : "h-48"
        }`}
      >
        {/* Header */}
        <CollapsibleTrigger className="flex items-center gap-2 px-3 py-1.5 text-xs hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors flex-shrink-0">
          <div
            className={`w-2 h-2 rounded-full ${
              anyRunning ? "bg-emerald-500 animate-pulse" : "bg-zinc-400"
            }`}
          />
          <span className="text-muted-foreground uppercase tracking-wider">
            Terminal
          </span>
          <span className="text-muted-foreground/50 ml-auto">
            {collapsed ? "\u25B2" : "\u25BC"}
          </span>
        </CollapsibleTrigger>

        {/* Content */}
        <CollapsibleContent className="flex-1 min-h-0">
          <div
            ref={scrollRef}
            className="flex-1 overflow-y-auto px-3 pb-2 font-mono text-xs leading-relaxed h-full"
          >
            {streamOutput.length === 0 ? (
              <span className="text-muted-foreground/50">Ready.</span>
            ) : (
              streamOutput.map((line, i) => (
                <div
                  key={i}
                  className={`whitespace-pre-wrap break-all ${
                    line.startsWith("[stderr]")
                      ? "text-amber-600 dark:text-amber-400"
                      : line.startsWith("[Error]") || line.startsWith("[Failed")
                        ? "text-red-600 dark:text-red-400"
                        : line.startsWith("[Process")
                          ? "text-muted-foreground"
                          : "text-zinc-700 dark:text-zinc-300"
                  }`}
                >
                  {line}
                </div>
              ))
            )}
          </div>
        </CollapsibleContent>
      </div>
    </Collapsible>
  );
}
