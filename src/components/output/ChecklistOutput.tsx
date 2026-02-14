import { useState } from "react";
import type { ChecklistItem } from "../../lib/types";

interface ChecklistOutputProps {
  output: string;
  onComplete: (items: ChecklistItem[]) => void;
  isApproved: boolean;
}

const severityColors = {
  critical: {
    border: "border-red-800",
    bg: "bg-red-950/30",
    badge: "bg-red-900 text-red-300",
  },
  warning: {
    border: "border-amber-800",
    bg: "bg-amber-950/30",
    badge: "bg-amber-900 text-amber-300",
  },
  info: {
    border: "border-blue-800",
    bg: "bg-blue-950/30",
    badge: "bg-blue-900 text-blue-300",
  },
};

export function ChecklistOutput({
  output,
  onComplete,
  isApproved,
}: ChecklistOutputProps) {
  let initialItems: ChecklistItem[] = [];
  try {
    const parsed = JSON.parse(output);
    initialItems = parsed.items ?? [];
  } catch {
    return (
      <div className="text-sm text-zinc-400">
        <p className="text-amber-400 mb-2">Could not parse checklist output.</p>
        <pre className="bg-zinc-900 p-3 rounded text-xs whitespace-pre-wrap">
          {output}
        </pre>
      </div>
    );
  }

  const [items, setItems] = useState<ChecklistItem[]>(initialItems);

  const toggleItem = (id: string) => {
    if (isApproved) return;
    setItems((prev) =>
      prev.map((item) =>
        item.id === id ? { ...item, checked: !item.checked } : item,
      ),
    );
  };

  const updateNotes = (id: string, notes: string) => {
    if (isApproved) return;
    setItems((prev) =>
      prev.map((item) => (item.id === id ? { ...item, notes } : item)),
    );
  };

  const allChecked = items.every((item) => item.checked);

  return (
    <div>
      <div className="space-y-3">
        {items.map((item) => {
          const colors = severityColors[item.severity] ?? severityColors.info;
          return (
            <div
              key={item.id}
              className={`rounded-lg border p-4 ${colors.border} ${colors.bg}`}
            >
              <div className="flex items-start gap-3">
                <input
                  type="checkbox"
                  checked={item.checked}
                  onChange={() => toggleItem(item.id)}
                  disabled={isApproved}
                  className="mt-0.5 accent-emerald-500"
                />
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    <span
                      className={`text-[10px] uppercase font-bold px-1.5 py-0.5 rounded ${colors.badge}`}
                    >
                      {item.severity}
                    </span>
                  </div>
                  <p className="text-sm text-zinc-200">{item.text}</p>
                  {!isApproved && (
                    <input
                      type="text"
                      value={item.notes}
                      onChange={(e) => updateNotes(item.id, e.target.value)}
                      placeholder="Notes..."
                      className="mt-2 w-full bg-transparent border-b border-zinc-700 text-xs text-zinc-400 pb-1 focus:outline-none focus:border-zinc-500"
                    />
                  )}
                  {isApproved && item.notes && (
                    <p className="mt-1 text-xs text-zinc-500 italic">
                      {item.notes}
                    </p>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {!isApproved && (
        <button
          onClick={() => onComplete(items)}
          disabled={!allChecked}
          className="mt-4 px-4 py-2 bg-emerald-600 hover:bg-emerald-500 disabled:bg-zinc-700 disabled:text-zinc-500 text-white rounded-lg text-sm font-medium transition-colors"
        >
          {allChecked ? "All Items Reviewed" : "Review All Items to Continue"}
        </button>
      )}
    </div>
  );
}
