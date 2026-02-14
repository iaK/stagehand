import { useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { useProjectStore } from "../../stores/projectStore";

interface ProjectCreateProps {
  onClose: () => void;
}

export function ProjectCreate({ onClose }: ProjectCreateProps) {
  const [name, setName] = useState("");
  const [path, setPath] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const addProject = useProjectStore((s) => s.addProject);

  const handleBrowse = async () => {
    try {
      const selected = await open({ directory: true });
      if (selected) {
        setPath(selected);
        if (!name) {
          const parts = selected.split("/");
          setName(parts[parts.length - 1] || "");
        }
      }
    } catch (err) {
      setError(`Browse failed: ${err}`);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !path.trim()) return;
    setError(null);
    setCreating(true);
    try {
      await addProject(name.trim(), path.trim());
      onClose();
    } catch (err) {
      setError(`Failed to create project: ${err}`);
      setCreating(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-zinc-900 border border-zinc-700 rounded-xl p-6 w-[480px] max-w-[90vw]">
        <h2 className="text-lg font-semibold text-zinc-100 mb-4">
          New Project
        </h2>
        <form onSubmit={handleSubmit}>
          <div className="mb-4">
            <label className="block text-sm text-zinc-400 mb-1">
              Project Name
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full bg-zinc-800 text-zinc-100 border border-zinc-700 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-500"
              placeholder="My Project"
              autoFocus
            />
          </div>
          <div className="mb-6">
            <label className="block text-sm text-zinc-400 mb-1">
              Project Directory
            </label>
            <div className="flex gap-2">
              <input
                type="text"
                value={path}
                onChange={(e) => setPath(e.target.value)}
                className="flex-1 bg-zinc-800 text-zinc-100 border border-zinc-700 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-500"
                placeholder="/path/to/project"
              />
              <button
                type="button"
                onClick={handleBrowse}
                className="px-3 py-2 bg-zinc-700 hover:bg-zinc-600 text-zinc-200 rounded-lg text-sm transition-colors"
              >
                Browse
              </button>
            </div>
          </div>
          {error && (
            <div className="mb-4 p-3 bg-red-950/30 border border-red-900 rounded-lg text-sm text-red-400">
              {error}
            </div>
          )}
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
              disabled={!name.trim() || !path.trim() || creating}
              className="px-4 py-2 text-sm bg-blue-600 hover:bg-blue-500 disabled:bg-zinc-700 disabled:text-zinc-500 text-white rounded-lg transition-colors"
            >
              {creating ? "Creating..." : "Create Project"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
