import { useState } from "react";
import { useTaskStore } from "../../stores/taskStore";
import type { Task } from "../../lib/types";

interface TaskCreateProps {
  projectId: string;
  onClose: () => void;
  task?: Task;
}

export function TaskCreate({ projectId, onClose, task }: TaskCreateProps) {
  const [title, setTitle] = useState(task?.title ?? "");
  const addTask = useTaskStore((s) => s.addTask);
  const updateTask = useTaskStore((s) => s.updateTask);

  const isEditing = !!task;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return;
    if (isEditing) {
      await updateTask(projectId, task.id, { title: title.trim() });
    } else {
      await addTask(projectId, title.trim());
    }
    onClose();
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-zinc-900 border border-zinc-700 rounded-xl p-6 w-[480px] max-w-[90vw]">
        <h2 className="text-lg font-semibold text-zinc-100 mb-4">
          {isEditing ? "Edit Task" : "New Task"}
        </h2>
        <form onSubmit={handleSubmit}>
          <div className="mb-6">
            <label className="block text-sm text-zinc-400 mb-1">Title</label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="w-full bg-zinc-800 text-zinc-100 border border-zinc-700 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-500"
              placeholder="What needs to be done?"
              autoFocus
            />
          </div>
          <div className="flex justify-end gap-3">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-sm text-zinc-400 hover:text-zinc-200 transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={!title.trim()}
              className="px-4 py-2 text-sm bg-blue-600 hover:bg-blue-500 disabled:bg-zinc-700 disabled:text-zinc-500 text-white rounded-lg transition-colors"
            >
              {isEditing ? "Save" : "Create Task"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
