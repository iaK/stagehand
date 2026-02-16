import { useState } from "react";
import { useTaskStore } from "../../stores/taskStore";
import { useProjectStore } from "../../stores/projectStore";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip";
import { AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle, AlertDialogDescription, AlertDialogFooter, AlertDialogCancel, AlertDialogAction } from "@/components/ui/alert-dialog";
import type { Task } from "../../lib/types";

const statusColors: Record<string, string> = {
  pending: "bg-zinc-400",
  in_progress: "bg-blue-500",
  completed: "bg-emerald-500",
  failed: "bg-red-500",
};

const pipelineColors: Record<string, string> = {
  running: "bg-blue-500 animate-pulse",
  awaiting_user: "bg-amber-500",
  approved: "bg-emerald-500",
  failed: "bg-red-500",
  pending: "bg-zinc-400",
};

interface TaskListProps {
  onEdit: (task: Task) => void;
}

export function TaskList({ onEdit }: TaskListProps) {
  const tasks = useTaskStore((s) => s.tasks);
  const activeTask = useTaskStore((s) => s.activeTask);
  const setActiveTask = useTaskStore((s) => s.setActiveTask);
  const updateTask = useTaskStore((s) => s.updateTask);
  const executions = useTaskStore((s) => s.executions);
  const activeProject = useProjectStore((s) => s.activeProject);
  const [archiveTarget, setArchiveTarget] = useState<Task | null>(null);

  // For the active task, derive color from the latest execution on its current stage
  const getTaskDotClass = (task: Task) => {
    if (task.id === activeTask?.id && task.current_stage_id && executions.length > 0) {
      const stageExecs = executions.filter(
        (e) => e.stage_template_id === task.current_stage_id,
      );
      const latestExec = stageExecs[stageExecs.length - 1];
      if (latestExec) {
        return pipelineColors[latestExec.status] ?? statusColors[task.status] ?? "bg-zinc-400";
      }
    }
    return statusColors[task.status] ?? "bg-zinc-400";
  };

  if (tasks.length === 0) {
    return (
      <p className="text-sm text-muted-foreground italic px-1 py-2">No tasks yet</p>
    );
  }

  const handleArchiveClick = (e: React.MouseEvent, task: Task) => {
    e.stopPropagation();
    setArchiveTarget(task);
  };

  const confirmArchive = async () => {
    if (!activeProject || !archiveTarget) return;
    if (activeTask?.id === archiveTarget.id) {
      setActiveTask(null);
    }
    await updateTask(activeProject.id, archiveTarget.id, { archived: 1 });
    setArchiveTarget(null);
  };

  return (
    <>
    <div className="space-y-1">
      {tasks.map((task) => {
        const isActive = activeTask?.id === task.id;
        return (
          <div
            key={task.id}
            className={`group flex items-center rounded-lg text-sm transition-colors ${
              isActive
                ? "bg-accent text-accent-foreground"
                : "text-muted-foreground hover:bg-accent/50 hover:text-foreground"
            }`}
          >
            <button
              onClick={() => setActiveTask(task)}
              className="flex-1 text-left px-3 py-2 min-w-0"
            >
              <div className="flex items-center gap-2">
                <div
                  className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${getTaskDotClass(task)}`}
                />
                <span className="truncate">{task.title}</span>
              </div>
            </button>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon-xs"
                  onClick={(e) => {
                    e.stopPropagation();
                    onEdit(task);
                  }}
                  className={`transition-opacity ${
                    isActive
                      ? "text-muted-foreground opacity-100"
                      : "text-muted-foreground opacity-0 group-hover:opacity-100"
                  }`}
                >
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                  </svg>
                </Button>
              </TooltipTrigger>
              <TooltipContent>Edit task</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon-xs"
                  onClick={(e) => handleArchiveClick(e, task)}
                  className={`mr-1 transition-opacity ${
                    isActive
                      ? "text-muted-foreground opacity-100"
                      : "text-muted-foreground opacity-0 group-hover:opacity-100"
                  }`}
                >
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 8h14M5 8a2 2 0 110-4h14a2 2 0 110 4M5 8v10a2 2 0 002 2h10a2 2 0 002-2V8m-9 4h4" />
                  </svg>
                </Button>
              </TooltipTrigger>
              <TooltipContent>Archive task</TooltipContent>
            </Tooltip>
          </div>
        );
      })}
    </div>
    <AlertDialog open={!!archiveTarget} onOpenChange={(open) => !open && setArchiveTarget(null)}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Archive Task</AlertDialogTitle>
          <AlertDialogDescription>
            Are you sure you want to archive <span className="font-medium text-foreground">"{archiveTarget?.title}"</span>?
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction variant="destructive" onClick={confirmArchive}>
            Archive
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
    </>
  );
}
