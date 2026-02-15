import { useRef, useEffect, useState } from "react";
import { useProcessStore, DEFAULT_STAGE_STATE } from "../../stores/processStore";

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
    <div
      className={`border-t border-zinc-800 bg-zinc-950 flex flex-col transition-all ${
        collapsed ? "h-8" : "h-48"
      }`}
    >
      {/* Header */}
      <button
        onClick={() => setCollapsed(!collapsed)}
        className="flex items-center gap-2 px-3 py-1.5 text-xs hover:bg-zinc-900 transition-colors flex-shrink-0"
      >
        <div
          className={`w-2 h-2 rounded-full ${
            anyRunning ? "bg-emerald-400 animate-pulse" : "bg-zinc-600"
          }`}
        />
        <span className="text-zinc-500 uppercase tracking-wider">
          Terminal
        </span>
        <span className="text-zinc-700 ml-auto">
          {collapsed ? "▲" : "▼"}
        </span>
      </button>

      {/* Content */}
      {!collapsed && (
        <div
          ref={scrollRef}
          className="flex-1 overflow-y-auto px-3 pb-2 font-mono text-xs leading-relaxed"
        >
          {streamOutput.length === 0 ? (
            <span className="text-zinc-700">Ready.</span>
          ) : (
            streamOutput.map((line, i) => (
              <div
                key={i}
                className={`whitespace-pre-wrap break-all ${
                  line.startsWith("[stderr]")
                    ? "text-amber-500"
                    : line.startsWith("[Error]") || line.startsWith("[Failed")
                      ? "text-red-400"
                      : line.startsWith("[Process")
                        ? "text-zinc-600"
                        : "text-zinc-300"
                }`}
              >
                {line}
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}
