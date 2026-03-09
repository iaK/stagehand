import { useState } from "react";
import { TextOutput } from "./TextOutput";
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
import { Loader2, CheckCircle2 } from "lucide-react";
import type { ProposedSubtask } from "../../lib/types";

interface TaskSplittingOutputProps {
  output: string;
  onSplit: (tasks: { title: string; description?: string; initialInput?: string }[]) => void;
  onApprove?: () => void;
  isApproved: boolean;
  approving?: boolean;
}

export function TaskSplittingOutput({
  output,
  onSplit,
  onApprove,
  isApproved,
  approving,
}: TaskSplittingOutputProps) {
  let reasoning = "";
  let initialTasks: ProposedSubtask[] = [];

  try {
    const parsed = JSON.parse(output);
    reasoning = parsed.reasoning ?? "";
    initialTasks = (parsed.proposed_tasks ?? []).map((t: ProposedSubtask) => ({
      ...t,
      selected: t.selected ?? true,
    }));
  } catch {
    return (
      <div>
        <TextOutput content={output} />
      </div>
    );
  }

  const hasTasks = initialTasks.length > 0;

  if (!hasTasks) {
    return (
      <div>
        <TextOutput content={reasoning} />
        {!isApproved ? (
          <div className="mt-6 p-4 bg-muted/50 border border-border rounded-lg space-y-3">
              <p className="text-sm font-medium">
                No subtasks proposed.
              </p>
            {onApprove && (
              <Button
                onClick={onApprove}
                disabled={approving}
              >
                {approving && <Loader2 className="w-4 h-4 animate-spin" />}
                {approving ? "Approving..." : "Approve & Continue"}
              </Button>
            )}
          </div>
        ) : (
          <div className="mt-6 p-4 bg-muted/50 border border-border rounded-lg flex items-center gap-2 text-sm text-muted-foreground">
            <CheckCircle2 className="w-4 h-4" />
              No subtasks needed — approved.
          </div>
        )}
      </div>
    );
  }

  return (
    <div>
      <TextOutput content={reasoning} />
      <SubtaskCards
        tasks={initialTasks}
        onSplit={onSplit}
        isApproved={isApproved}
        approving={approving}
      />
    </div>
  );
}

function SubtaskCards({
  tasks: initialTasks,
  onSplit,
  isApproved,
  approving,
}: {
  tasks: ProposedSubtask[];
  onSplit: (tasks: { title: string; description?: string; initialInput?: string }[]) => void;
  isApproved: boolean;
  approving?: boolean;
}) {
  const [tasks, setTasks] = useState<ProposedSubtask[]>(initialTasks);
  const [splitting, setSplitting] = useState(false);

  const selectedCount = tasks.filter((t) => t.selected).length;
  const allSelected = selectedCount === tasks.length;

  const toggleTask = (id: string) => {
    if (isApproved) return;
    setTasks((prev) =>
      prev.map((t) => (t.id === id ? { ...t, selected: !t.selected } : t)),
    );
  };

  const toggleAll = () => {
    if (isApproved) return;
    const newValue = !allSelected;
    setTasks((prev) => prev.map((t) => ({ ...t, selected: newValue })));
  };

  const handleSplit = () => {
    setSplitting(true);
    const selected = tasks.filter((t) => t.selected);
    onSplit(selected.map((t) => ({ title: t.title, description: t.description, initialInput: t.description })));
  };

  return (
    <div className="mt-6">
      {!isApproved && (
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-medium text-foreground">
            {tasks.length} subtask{tasks.length !== 1 ? "s" : ""} proposed
          </h3>
          <Button variant="ghost" size="sm" onClick={toggleAll}>
            {allSelected ? "Deselect All" : "Select All"}
          </Button>
        </div>
      )}

      <div className="space-y-3">
        {tasks.map((task) => (
          <div
            key={task.id}
            onClick={() => toggleTask(task.id)}
            className={`rounded-lg border p-4 transition-colors ${
              isApproved ? "" : "cursor-pointer"
            } border-violet-200 dark:border-violet-500/20 ${
              task.selected
                ? "bg-violet-50 dark:bg-violet-500/10"
                : "bg-zinc-50 dark:bg-zinc-900 opacity-60"
            }`}
          >
            <div className="flex items-start gap-3">
              {!isApproved && (
                <Checkbox
                  checked={task.selected}
                  onCheckedChange={() => toggleTask(task.id)}
                  disabled={isApproved}
                  onClick={(e) => e.stopPropagation()}
                  className="mt-0.5"
                />
              )}
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-foreground">
                  {task.title}
                </p>
                <p className="text-sm text-muted-foreground mt-1">
                  {task.description}
                </p>
              </div>
            </div>
          </div>
        ))}
      </div>

      {!isApproved && (
        <div className="flex items-center gap-3 mt-4">
          <Button
            onClick={handleSplit}
            disabled={selectedCount === 0 || splitting || approving}
          >
            {(splitting || approving) && <Loader2 className="w-4 h-4 animate-spin" />}
            {splitting || approving ? "Splitting..." : `Split Task (${selectedCount})`}
          </Button>
        </div>
      )}
    </div>
  );
}
