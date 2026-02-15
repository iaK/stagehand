import { useState } from "react";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { ChecklistItem } from "../../lib/types";

interface ChecklistOutputProps {
  output: string;
  onComplete: (items: ChecklistItem[]) => void;
  isApproved: boolean;
}

const severityVariant: Record<string, "critical" | "warning" | "info"> = {
  critical: "critical",
  warning: "warning",
  info: "info",
};

const severityCardColors = {
  critical: "border-red-200 bg-red-50",
  warning: "border-amber-200 bg-amber-50",
  info: "border-blue-200 bg-blue-50",
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
      <div className="text-sm text-muted-foreground">
        <p className="text-amber-600 mb-2">Could not parse checklist output.</p>
        <pre className="bg-zinc-50 border border-border p-3 rounded text-xs whitespace-pre-wrap">
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
          const colors = severityCardColors[item.severity] ?? severityCardColors.info;
          const badgeVar = severityVariant[item.severity] ?? "info";
          return (
            <div
              key={item.id}
              className={`rounded-lg border p-4 ${colors}`}
            >
              <div className="flex items-start gap-3">
                <Checkbox
                  checked={item.checked}
                  onCheckedChange={() => toggleItem(item.id)}
                  disabled={isApproved}
                  className="mt-0.5"
                />
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    <Badge variant={badgeVar} className="text-[10px] uppercase font-bold">
                      {item.severity}
                    </Badge>
                  </div>
                  <p className="text-sm text-zinc-700">{item.text}</p>
                  {!isApproved && (
                    <Input
                      type="text"
                      value={item.notes}
                      onChange={(e) => updateNotes(item.id, e.target.value)}
                      placeholder="Notes..."
                      className="mt-2 h-7 text-xs bg-transparent border-0 border-b border-zinc-300 rounded-none shadow-none focus-visible:ring-0 focus-visible:border-zinc-500 px-0"
                    />
                  )}
                  {isApproved && item.notes && (
                    <p className="mt-1 text-xs text-muted-foreground italic">
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
        <Button
          variant="success"
          onClick={() => onComplete(items)}
          disabled={!allChecked}
          className="mt-4"
        >
          {allChecked ? "All Items Reviewed" : "Review All Items to Continue"}
        </Button>
      )}
    </div>
  );
}
