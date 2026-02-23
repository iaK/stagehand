import { useState, useMemo, useCallback } from "react";
import { useTaskStore } from "../../stores/taskStore";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const TERMINAL_FORMATS = new Set(["research", "pr_preparation", "pr_review", "merge", "task_splitting"]);

interface InsertStageButtonProps {
  taskId: string;
  projectId: string;
  /** sort_order of the current (approved) stage */
  currentSortOrder: number;
  /** sort_order of the next stage, or null if at end */
  nextSortOrder: number | null;
}

export function InsertStageButton({
  taskId,
  projectId,
  currentSortOrder,
  nextSortOrder,
}: InsertStageButtonProps) {
  const stageTemplates = useTaskStore((s) => s.stageTemplates);
  const insertTaskStage = useTaskStore((s) => s.insertTaskStage);
  const [open, setOpen] = useState(false);
  const [selectedTemplateId, setSelectedTemplateId] = useState<string>("");
  const [inserting, setInserting] = useState(false);

  const insertableTemplates = useMemo(
    () => stageTemplates.filter((t) => !TERMINAL_FORMATS.has(t.output_format)),
    [stageTemplates],
  );

  const handleInsert = useCallback(async () => {
    if (!selectedTemplateId) return;
    setInserting(true);
    try {
      let sortOrder: number;
      if (nextSortOrder !== null) {
        const gap = nextSortOrder - currentSortOrder;
        if (gap < 2) {
          // Gap too small — place after current with a standard gap.
          // The store reload will reflect accurate sort_orders.
          sortOrder = currentSortOrder + 500;
        } else {
          sortOrder = Math.floor((currentSortOrder + nextSortOrder) / 2);
        }
      } else {
        sortOrder = currentSortOrder + 1000;
      }

      await insertTaskStage(projectId, taskId, selectedTemplateId, sortOrder);
      setOpen(false);
      setSelectedTemplateId("");
    } finally {
      setInserting(false);
    }
  }, [selectedTemplateId, currentSortOrder, nextSortOrder, projectId, taskId, insertTaskStage]);

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="mt-4 flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors group"
      >
        <span className="w-5 h-5 rounded-full border border-dashed border-muted-foreground/40 group-hover:border-foreground/60 flex items-center justify-center transition-colors">
          <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
        </span>
        Insert stage after this one
      </button>
    );
  }

  return (
    <div className="mt-4 p-4 border border-dashed border-border rounded-lg bg-muted/30">
      <div className="flex items-center gap-2 mb-3">
        <svg className="w-4 h-4 text-muted-foreground" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
        </svg>
        <span className="text-sm font-medium">Insert Stage</span>
      </div>

      <div className="space-y-3">
        <Select value={selectedTemplateId} onValueChange={setSelectedTemplateId}>
          <SelectTrigger className="w-full">
            <SelectValue placeholder="Select a stage template..." />
          </SelectTrigger>
          <SelectContent>
            {insertableTemplates.map((t) => (
              <SelectItem key={t.id} value={t.id}>
                {t.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <div className="flex gap-2">
          <Button
            size="sm"
            onClick={handleInsert}
            disabled={!selectedTemplateId || inserting}
          >
            {inserting ? "Inserting..." : "Insert"}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => { setOpen(false); setSelectedTemplateId(""); }}
            disabled={inserting}
          >
            Cancel
          </Button>
        </div>
      </div>
    </div>
  );
}
