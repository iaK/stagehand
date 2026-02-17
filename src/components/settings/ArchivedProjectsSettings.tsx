import { useEffect, useState } from "react";
import { useProjectStore } from "../../stores/projectStore";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { sendNotification } from "../../lib/notifications";

export function ArchivedProjectsSettings() {
  const { archivedProjects, loadArchivedProjects, unarchiveProject } =
    useProjectStore();
  const [error, setError] = useState<string | null>(null);

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

      {error && (
        <Alert variant="destructive" className="mb-4">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

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
                  setError(null);
                  try {
                    await unarchiveProject(p.id);
                    sendNotification("Project unarchived", p.name, { projectId: p.id });
                  } catch (err) {
                    setError(`Failed to unarchive project: ${err}`);
                  }
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
