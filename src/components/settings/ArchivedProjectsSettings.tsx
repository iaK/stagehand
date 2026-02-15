import { useEffect } from "react";
import { useProjectStore } from "../../stores/projectStore";

export function ArchivedProjectsSettings() {
  const { archivedProjects, loadArchivedProjects, unarchiveProject } =
    useProjectStore();

  useEffect(() => {
    loadArchivedProjects();
  }, [loadArchivedProjects]);

  return (
    <div>
      <h3 className="text-sm font-medium text-zinc-100 mb-1">
        Archived Projects
      </h3>
      <p className="text-xs text-zinc-500 mb-4">
        Projects you've archived. Unarchive them to restore access.
      </p>

      {archivedProjects.length === 0 ? (
        <p className="text-sm text-zinc-600 italic">No archived projects</p>
      ) : (
        <div className="space-y-1">
          {archivedProjects.map((p) => (
            <div
              key={p.id}
              className="group flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-zinc-800 transition-colors"
            >
              <span className="flex-1 text-sm text-zinc-300 truncate">
                {p.name}
              </span>
              <button
                onClick={() => unarchiveProject(p.id)}
                className="opacity-0 group-hover:opacity-100 px-2 py-1 text-xs text-zinc-400 hover:text-zinc-200 bg-zinc-700 hover:bg-zinc-600 rounded transition-all"
              >
                Unarchive
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
