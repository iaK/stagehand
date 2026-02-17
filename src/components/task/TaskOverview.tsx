import { useState, useEffect } from "react";
import { useTaskStore } from "../../stores/taskStore";
import { useProjectStore } from "../../stores/projectStore";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { gitLog, type GitCommit } from "../../lib/git";
import { getTaskWorkingDir } from "../../lib/worktree";

function formatDate(iso: string): string {
  const date = new Date(iso);
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }) + " at " + date.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
  });
}

function formatRelativeTime(iso: string): string {
  const now = Date.now();
  const then = new Date(iso).getTime();
  const diffMs = now - then;
  const diffMins = Math.floor(diffMs / 60000);
  if (diffMins < 1) return "just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  const diffDays = Math.floor(diffHours / 24);
  return `${diffDays}d ago`;
}

const statusConfig: Record<string, { label: string; variant: "success" | "info" | "secondary" | "critical" }> = {
  completed: { label: "Completed", variant: "success" },
  in_progress: { label: "In Progress", variant: "info" },
  pending: { label: "Pending", variant: "secondary" },
  failed: { label: "Failed", variant: "critical" },
};

export function TaskOverview() {
  const activeTask = useTaskStore((s) => s.activeTask);
  const stageTemplates = useTaskStore((s) => s.stageTemplates);
  const activeProject = useProjectStore((s) => s.activeProject);

  const [commits, setCommits] = useState<GitCommit[]>([]);
  const [commitsLoading, setCommitsLoading] = useState(true);

  useEffect(() => {
    if (!activeTask || !activeProject) {
      setCommits([]);
      setCommitsLoading(false);
      return;
    }

    let cancelled = false;
    setCommitsLoading(true);

    const workDir = getTaskWorkingDir(activeTask, activeProject.path);
    gitLog(workDir).then((result) => {
      if (!cancelled) {
        setCommits(result);
        setCommitsLoading(false);
      }
    });

    return () => { cancelled = true; };
  }, [activeTask?.id, activeProject?.path]);

  if (!activeTask) return null;

  const status = statusConfig[activeTask.status] ?? statusConfig.pending;
  const currentStage = activeTask.current_stage_id
    ? stageTemplates.find((s) => s.id === activeTask.current_stage_id)
    : null;

  return (
    <div className="max-w-4xl mx-auto p-6 space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-1 min-w-0">
          <h1 className="text-xl font-semibold truncate">{activeTask.title}</h1>
          {activeTask.description && (
            <p className="text-sm text-muted-foreground">{activeTask.description}</p>
          )}
        </div>
        <Badge variant={status.variant}>{status.label}</Badge>
      </div>

      <Separator />

      {/* Info Grid */}
      <div className="grid grid-cols-2 gap-4">
        <InfoCard label="Started" value={formatDate(activeTask.created_at)} />
        <InfoCard
          label="Current Stage"
          value={currentStage?.name ?? "Not started"}
        />
        <InfoCard
          label="Branch"
          value={activeTask.branch_name ?? "No branch"}
          mono
        />
        <InfoCard
          label="Pull Request"
          value={activeTask.pr_url ? undefined : "No PR created yet"}
          muted={!activeTask.pr_url}
        >
          {activeTask.pr_url && (
            <a
              href={activeTask.pr_url}
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm text-blue-600 hover:underline truncate block"
            >
              {activeTask.pr_url.replace(/^https?:\/\//, "")}
            </a>
          )}
        </InfoCard>
      </div>

      {activeTask.status === "completed" && (
        <div className="rounded-lg border border-border bg-card px-4 py-3">
          <span className="text-xs text-muted-foreground">Finished</span>
          <p className="text-sm font-medium">{formatDate(activeTask.updated_at)}</p>
        </div>
      )}

      <Separator />

      {/* Commits */}
      <Card>
        <CardHeader className="pb-0">
          <CardTitle className="text-base">
            Commits{!commitsLoading && ` (${commits.length})`}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {commitsLoading ? (
            <p className="text-sm text-muted-foreground">Loading commits...</p>
          ) : commits.length === 0 ? (
            <p className="text-sm text-muted-foreground">No commits yet</p>
          ) : (
            <div className="space-y-2">
              {commits.map((commit) => (
                <div
                  key={commit.hash}
                  className="flex items-baseline gap-3 text-sm"
                >
                  <code className="text-xs text-muted-foreground font-mono shrink-0">
                    {commit.hash.slice(0, 7)}
                  </code>
                  <span className="truncate">{commit.message}</span>
                  <span className="text-xs text-muted-foreground shrink-0 ml-auto">
                    {formatRelativeTime(commit.date)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function InfoCard({
  label,
  value,
  mono,
  muted,
  children,
}: {
  label: string;
  value?: string;
  mono?: boolean;
  muted?: boolean;
  children?: React.ReactNode;
}) {
  return (
    <div className="rounded-lg border border-border bg-card px-4 py-3">
      <span className="text-xs text-muted-foreground">{label}</span>
      {children ?? (
        <p
          className={`text-sm font-medium truncate ${mono ? "font-mono" : ""} ${muted ? "text-muted-foreground" : ""}`}
        >
          {value}
        </p>
      )}
    </div>
  );
}
