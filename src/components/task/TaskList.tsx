import { useCallback, useRef, useEffect, memo } from "react";
import { useTaskStore } from "../../stores/taskStore";
import { Input } from "@/components/ui/input";
import { useProcessStore, stageKey } from "../../stores/processStore";
import { statusColors, pipelineColors } from "../../lib/taskStatus";
import type { Task } from "../../lib/types";

export function TaskList({ searchOpen, query, onQueryChange }: {
  searchOpen: boolean;
  query: string;
  onQueryChange: (q: string) => void;
}) {
  const tasks = useTaskStore((s) => s.tasks);
  const activeTask = useTaskStore((s) => s.activeTask);
  const setActiveTask = useTaskStore((s) => s.setActiveTask);
  const taskExecStatuses = useTaskStore((s) => s.taskExecStatuses);
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (searchOpen) searchRef.current?.focus();
  }, [searchOpen]);

  const getTaskDotClass = (task: Task) => {
    if (task.status === "completed") return statusColors.completed;

    if (task.id === activeTask?.id && task.current_stage_id) {
      const sk = stageKey(task.id, task.current_stage_id);
      const stageState = useProcessStore.getState().stages[sk];
      if (stageState?.isRunning) return pipelineColors.running;
    }

    const execStatus = taskExecStatuses[task.id];
    if (execStatus === "approved" && task.status === "in_progress") {
      return pipelineColors.awaiting_user;
    }
    if (execStatus && execStatus !== "failed" && execStatus !== "approved") {
      return pipelineColors[execStatus] ?? statusColors[task.status] ?? "bg-zinc-400";
    }
    if (execStatus === "failed" && task.status === "failed") {
      return pipelineColors.failed;
    }
    return statusColors[task.status] ?? "bg-zinc-400";
  };

  const handleSelectTask = useCallback((task: Task) => setActiveTask(task), [setActiveTask]);

  const filtered = tasks.filter(t => !query || t.title.toLowerCase().includes(query.toLowerCase()));

  if (tasks.length === 0) {
    return (
      <p className="text-sm text-muted-foreground italic px-1 py-2">No tasks yet</p>
    );
  }

  return (
    <>
    {searchOpen && (
      <div className="px-1 pb-2">
        <Input
          ref={searchRef}
          type="text"
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
          placeholder="Search tasks..."
          className="h-7 text-xs"
        />
      </div>
    )}
    <div className="space-y-0.5">
      {filtered.length === 0 && query ? (
        <p className="text-sm text-muted-foreground italic px-1 py-2">No matching tasks</p>
      ) : filtered.map((task) => {
        const isActive = activeTask?.id === task.id;
        return (
          <TaskListItem
            key={task.id}
            task={task}
            isActive={isActive}
            dotClass={getTaskDotClass(task)}
            onSelect={handleSelectTask}
          />
        );
      })}
    </div>
    </>
  );
}

const TaskListItem = memo(function TaskListItem({
  task,
  isActive,
  dotClass,
  onSelect,
}: {
  task: Task;
  isActive: boolean;
  dotClass: string;
  onSelect: (task: Task) => void;
}) {
  return (
    <button
      onClick={() => onSelect(task)}
      className={`w-full text-left flex items-center rounded-lg text-sm transition-colors px-3 py-2 ${
        isActive
          ? "bg-accent text-accent-foreground"
          : "text-muted-foreground hover:bg-accent/50 hover:text-foreground"
      }`}
    >
      <div className="flex items-center gap-2 min-w-0">
        <div
          className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${dotClass}`}
        />
        <span className="truncate">{task.title}</span>
        {task.ejected === 1 && (
          <span className="ml-1 text-[10px] px-1.5 py-0.5 rounded bg-primary/10 text-primary font-medium shrink-0">
            ejected
          </span>
        )}
      </div>
    </button>
  );
});
