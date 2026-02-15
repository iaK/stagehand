import { useState } from "react";
import { useTaskStore } from "../../stores/taskStore";
import { useProjectStore } from "../../stores/projectStore";
import type { Task } from "../../lib/types";

const statusColors: Record<string, string> = {
  pending: "bg-zinc-600",
  in_progress: "bg-blue-500",
  completed: "bg-emerald-500",
  failed: "bg-red-500",
};

const pipelineColors: Record<string, string> = {
  running: "bg-blue-500 animate-pulse",
  awaiting_user: "bg-amber-500",
  approved: "bg-emerald-500",
  failed: "bg-red-500",
  pending: "bg-zinc-600",
};

interface TaskListProps {
  onEdit: (task: Task) => void;
}

export function TaskList({ onEdit }: TaskListProps) {
  const { tasks, activeTask, setActiveTask, updateTask, executions } = useTaskStore();
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
        return pipelineColors[latestExec.status] ?? statusColors[task.status] ?? "bg-zinc-600";
      }
    }
    return statusColors[task.status] ?? "bg-zinc-600";
  };

  if (tasks.length === 0) {
    return (
      <p className="text-sm text-zinc-600 italic px-1 py-2">No tasks yet</p>
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
                ? "bg-zinc-700 text-zinc-100"
                : "text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200"
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
            <button
              onClick={(e) => {
                e.stopPropagation();
                onEdit(task);
              }}
              className={`p-1.5 hover:text-zinc-300 transition-opacity ${
                isActive
                  ? "text-zinc-500 opacity-100"
                  : "text-zinc-600 opacity-0 group-hover:opacity-100"
              }`}
              title="Edit task"
            >
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
              </svg>
            </button>
            <button
              onClick={(e) => handleArchiveClick(e, task)}
              className={`p-1.5 mr-1 hover:text-zinc-300 transition-opacity ${
                isActive
                  ? "text-zinc-500 opacity-100"
                  : "text-zinc-600 opacity-0 group-hover:opacity-100"
              }`}
              title="Archive task"
            >
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 8h14M5 8a2 2 0 110-4h14a2 2 0 110 4M5 8v10a2 2 0 002 2h10a2 2 0 002-2V8m-9 4h4" />
              </svg>
            </button>
          </div>
        );
      })}
    </div>
    {archiveTarget && (
      <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
        <div className="bg-zinc-900 border border-zinc-700 rounded-xl p-6 w-[400px] max-w-[90vw]">
          <h2 className="text-lg font-semibold text-zinc-100 mb-2">Archive Task</h2>
          <p className="text-sm text-zinc-400 mb-6">
            Are you sure you want to archive <span className="text-zinc-200">"{archiveTarget.title}"</span>?
          </p>
          <div className="flex justify-end gap-3">
            <button
              onClick={() => setArchiveTarget(null)}
              className="px-4 py-2 text-sm text-zinc-400 hover:text-zinc-200 transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={confirmArchive}
              className="px-4 py-2 text-sm bg-red-600 hover:bg-red-500 text-white rounded-lg transition-colors"
            >
              Archive
            </button>
          </div>
        </div>
      </div>
    )}
    </>
  );
}
