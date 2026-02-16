import { useEffect } from "react";
import { useProjectStore } from "../../stores/projectStore";
import { Button } from "@/components/ui/button";
import { sendNotification } from "../../lib/notifications";

export function ArchivedProjectsSettings() {
  const { archivedProjects, loadArchivedProjects, unarchiveProject } =
    useProjectStore();

  useEffect(() => {
    loadArchivedProjects();
  }, [loadArchivedProjects]);

  return (
    <div>
      <h3 className="text-sm font-medium text-foreground mb-1">
        Archived Projects
      </h3>
      <p className="text-xs text-muted-foreground mb-4">
        Projects you've archived. Unarchive them to restore access.
      </p>

      {archivedProjects.length === 0 ? (
        <p className="text-sm text-muted-foreground italic">No archived projects</p>
      ) : (
        <div className="space-y-1">
          {archivedProjects.map((p) => (
            <div
              key={p.id}
              className="group flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-accent transition-colors"
            >
              <span className="flex-1 text-sm text-foreground truncate">
                {p.name}
              </span>
              <Button
                variant="outline"
                size="xs"
                onClick={async () => {
                  await unarchiveProject(p.id);
                  sendNotification("Project unarchived", p.name);
                }}
                className="opacity-0 group-hover:opacity-100 transition-opacity"
              >
                Unarchive
              </Button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
