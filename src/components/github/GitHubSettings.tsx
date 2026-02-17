import { useEffect } from "react";
import { useGitHubStore } from "../../stores/githubStore";
import { useProjectStore } from "../../stores/projectStore";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";

export function GitHubSettingsContent({ projectId }: { projectId: string }) {
  const activeProject = useProjectStore((s) => s.activeProject);
  const { remoteUrl, repoFullName, defaultBranch, loading, error, loadForProject, refresh } =
    useGitHubStore();

  useEffect(() => {
    if (activeProject) {
      loadForProject(projectId, activeProject.path);
    }
  }, [projectId, activeProject, loadForProject]);

  const handleRefresh = () => {
    if (activeProject) {
      refresh(projectId, activeProject.path);
    }
  };

  if (loading) {
    return (
      <div className="text-sm text-muted-foreground">Detecting git remote...</div>
    );
  }

  if (error) {
    return (
      <div>
        <p className="text-sm text-destructive mb-3">{error}</p>
        <Button variant="outline" size="sm" onClick={handleRefresh}>
          Retry
        </Button>
      </div>
    );
  }

  if (!remoteUrl) {
    return (
      <div>
        <div className="flex items-center gap-2 p-3 bg-muted rounded-lg mb-3">
          <div className="w-2 h-2 rounded-full bg-yellow-500" />
          <span className="text-sm text-muted-foreground">
            No git remote detected
          </span>
        </div>
        <p className="text-xs text-muted-foreground mb-3">
          This project directory doesn't have an <code className="text-foreground">origin</code> remote configured.
          Add one with <code className="text-foreground">git remote add origin &lt;url&gt;</code> and refresh.
        </p>
        <Button variant="outline" size="sm" onClick={handleRefresh}>
          Refresh
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 p-3 bg-muted rounded-lg">
        <div className="w-2 h-2 rounded-full bg-green-500" />
        <span className="text-sm text-muted-foreground">
          Git remote detected
        </span>
      </div>

      <div>
        <Label className="text-xs text-muted-foreground">Repository</Label>
        <div className="flex items-center gap-2 p-2 bg-muted border border-border rounded-lg mt-1">
          <svg className="w-4 h-4 text-muted-foreground flex-shrink-0" viewBox="0 0 24 24" fill="currentColor">
            <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0024 12c0-6.63-5.37-12-12-12z" />
          </svg>
          <span className="text-sm text-foreground">{repoFullName ?? remoteUrl}</span>
        </div>
      </div>

      <div>
        <Label className="text-xs text-muted-foreground">Default Branch</Label>
        <div className="text-sm text-foreground mt-1">{defaultBranch}</div>
      </div>

      <div>
        <Label className="text-xs text-muted-foreground">Remote URL</Label>
        <div className="text-sm text-foreground mt-1 font-mono text-xs break-all">{remoteUrl}</div>
      </div>

      <Button variant="outline" size="sm" onClick={handleRefresh}>
        Refresh
      </Button>
    </div>
  );
}
