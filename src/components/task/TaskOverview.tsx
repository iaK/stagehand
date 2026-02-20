import { useState, useEffect, useMemo, useRef } from "react";
import { useTaskStore } from "../../stores/taskStore";
import { useProjectStore } from "../../stores/projectStore";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { gitLog, gitLogBranchDiff, gitListBranches, type GitCommit } from "../../lib/git";
import { useGitHubStore } from "../../stores/githubStore";
import { getTaskWorkingDir } from "../../lib/worktree";
import type { StageExecution } from "../../lib/types";

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

function formatTokenCount(n: number): string {
  return n.toLocaleString();
}

function formatDuration(ms: number): string {
  const totalSecs = Math.floor(ms / 1000);
  const mins = Math.floor(totalSecs / 60);
  const secs = totalSecs % 60;
  if (mins === 0) return `${secs}s`;
  return `${mins}m ${secs}s`;
}

function formatCost(usd: number): string {
  return `$${usd.toFixed(2)}`;
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
  const executions = useTaskStore((s) => s.executions);
  const activeProject = useProjectStore((s) => s.activeProject);
  const defaultBranch = useGitHubStore((s) => s.defaultBranch);
  const setDefaultBranch = useGitHubStore((s) => s.setDefaultBranch);

  const [commits, setCommits] = useState<GitCommit[]>([]);
  const [commitsLoading, setCommitsLoading] = useState(true);
  const [showTokenDetails, setShowTokenDetails] = useState(false);
  const [branchPickerOpen, setBranchPickerOpen] = useState(false);
  const [branches, setBranches] = useState<string[]>([]);

  const tokenTotals = useMemo(() => {
    const withData = executions.filter((e) => e.total_cost_usd != null);
    if (withData.length === 0) return null;
    return {
      total_cost_usd: withData.reduce((s, e) => s + (e.total_cost_usd ?? 0), 0),
      input_tokens: withData.reduce((s, e) => s + (e.input_tokens ?? 0), 0),
      output_tokens: withData.reduce((s, e) => s + (e.output_tokens ?? 0), 0),
      cache_creation_input_tokens: withData.reduce((s, e) => s + (e.cache_creation_input_tokens ?? 0), 0),
      cache_read_input_tokens: withData.reduce((s, e) => s + (e.cache_read_input_tokens ?? 0), 0),
      duration_ms: withData.reduce((s, e) => s + (e.duration_ms ?? 0), 0),
      num_turns: withData.reduce((s, e) => s + (e.num_turns ?? 0), 0),
    };
  }, [executions]);

  const perStageUsage = useMemo(() => {
    if (!tokenTotals) return [];
    const byStage = new Map<string, StageExecution>();
    for (const exec of executions) {
      if (exec.total_cost_usd == null) continue;
      const existing = byStage.get(exec.stage_template_id);
      if (!existing || exec.attempt_number > existing.attempt_number) {
        byStage.set(exec.stage_template_id, exec);
      }
    }
    return stageTemplates
      .filter((t) => byStage.has(t.id))
      .map((t) => ({ stage: t, execution: byStage.get(t.id)! }));
  }, [executions, stageTemplates, tokenTotals]);

  useEffect(() => {
    if (!activeTask || !activeProject) {
      setCommits([]);
      setCommitsLoading(false);
      return;
    }

    let cancelled = false;
    setCommitsLoading(true);

    const workDir = getTaskWorkingDir(activeTask, activeProject.path);
    const fetchCommits = defaultBranch
      ? gitLogBranchDiff(workDir, defaultBranch)
      : gitLog(workDir);

    fetchCommits.then((result) => {
      if (!cancelled) {
        setCommits(result);
        setCommitsLoading(false);
      }
    });

    return () => { cancelled = true; };
  }, [activeTask?.id, activeProject?.path, defaultBranch]);

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
        <div className="col-span-2 rounded-lg border border-border bg-card px-4 py-3">
          <span className="text-xs text-muted-foreground">Branch</span>
          <div className="flex items-center gap-2 text-sm font-medium font-mono mt-0.5">
            <span className="truncate">{activeTask.branch_name ?? "No branch"}</span>
            <span className="text-muted-foreground shrink-0">&rarr;</span>
            <BranchPicker
              value={defaultBranch ?? "main"}
              branches={branches}
              open={branchPickerOpen}
              onOpenChange={(open) => {
                setBranchPickerOpen(open);
                if (open && activeProject) {
                  gitListBranches(activeProject.path).then(setBranches);
                }
              }}
              onSelect={(branch) => {
                if (branch !== defaultBranch) {
                  setDefaultBranch(branch, activeProject?.id);
                }
                setBranchPickerOpen(false);
              }}
            />
          </div>
        </div>
        {activeTask.ejected === 1 && (
          <InfoCard label="Status" value="Ejected to main repo" />
        )}
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

      {/* Token Usage */}
      {tokenTotals && (
        <>
          <Separator />
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Token Usage</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <span className="text-xs text-muted-foreground">Total Cost</span>
                  <p className="text-sm font-medium">{formatCost(tokenTotals.total_cost_usd)}</p>
                </div>
                <div>
                  <span className="text-xs text-muted-foreground">Tokens</span>
                  <p className="text-sm font-medium">
                    {formatTokenCount(tokenTotals.input_tokens)} in / {formatTokenCount(tokenTotals.output_tokens)} out
                  </p>
                </div>
                <div>
                  <span className="text-xs text-muted-foreground">Duration</span>
                  <p className="text-sm font-medium">{formatDuration(tokenTotals.duration_ms)}</p>
                </div>
                <div>
                  <span className="text-xs text-muted-foreground">Turns</span>
                  <p className="text-sm font-medium">{tokenTotals.num_turns}</p>
                </div>
              </div>

              {perStageUsage.length > 1 && (
                <div>
                  <button
                    onClick={() => setShowTokenDetails((v) => !v)}
                    className="text-xs text-muted-foreground hover:text-foreground transition-colors"
                  >
                    {showTokenDetails ? "Hide details" : "Show details"}
                  </button>

                  {showTokenDetails && (
                    <div className="mt-2 overflow-x-auto">
                      <table className="w-full text-xs">
                        <thead>
                          <tr className="border-b border-border text-muted-foreground">
                            <th className="text-left py-1.5 pr-3 font-medium">Stage</th>
                            <th className="text-right py-1.5 px-3 font-medium">Cost</th>
                            <th className="text-right py-1.5 px-3 font-medium">Input</th>
                            <th className="text-right py-1.5 px-3 font-medium">Output</th>
                            <th className="text-right py-1.5 px-3 font-medium">Cache Read</th>
                            <th className="text-right py-1.5 px-3 font-medium">Duration</th>
                            <th className="text-right py-1.5 pl-3 font-medium">Turns</th>
                          </tr>
                        </thead>
                        <tbody>
                          {perStageUsage.map(({ stage, execution }) => (
                            <tr key={stage.id} className="border-b border-border/50">
                              <td className="py-1.5 pr-3">{stage.name}</td>
                              <td className="text-right py-1.5 px-3">
                                {execution.total_cost_usd != null ? formatCost(execution.total_cost_usd) : "\u2014"}
                              </td>
                              <td className="text-right py-1.5 px-3">
                                {execution.input_tokens != null ? formatTokenCount(execution.input_tokens) : "\u2014"}
                              </td>
                              <td className="text-right py-1.5 px-3">
                                {execution.output_tokens != null ? formatTokenCount(execution.output_tokens) : "\u2014"}
                              </td>
                              <td className="text-right py-1.5 px-3">
                                {execution.cache_read_input_tokens != null ? formatTokenCount(execution.cache_read_input_tokens) : "\u2014"}
                              </td>
                              <td className="text-right py-1.5 px-3">
                                {execution.duration_ms != null ? formatDuration(execution.duration_ms) : "\u2014"}
                              </td>
                              <td className="text-right py-1.5 pl-3">
                                {execution.num_turns != null ? execution.num_turns : "\u2014"}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              )}
            </CardContent>
          </Card>
        </>
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
            <div className="space-y-2">
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-5/6" />
              <Skeleton className="h-4 w-4/6" />
            </div>
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

function BranchPicker({
  value,
  branches,
  open,
  onOpenChange,
  onSelect,
}: {
  value: string;
  branches: string[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelect: (branch: string) => void;
}) {
  const [search, setSearch] = useState("");
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const filtered = useMemo(() => {
    if (!search) return branches;
    const q = search.toLowerCase();
    return branches.filter((b) => b.toLowerCase().includes(q));
  }, [branches, search]);

  useEffect(() => {
    if (open) {
      setSearch("");
      // Focus the input after a tick so the popover is rendered
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        onOpenChange(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [open, onOpenChange]);

  return (
    <div className="relative shrink-0" ref={containerRef}>
      <button
        onClick={() => onOpenChange(!open)}
        className="hover:text-blue-600 transition-colors text-left"
        title="Click to change target branch"
      >
        {value}
      </button>
      {open && (
        <div className="absolute top-full left-0 mt-1 z-50 w-64 rounded-md border border-border bg-popover shadow-md">
          <div className="p-1.5">
            <Input
              ref={inputRef}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape") onOpenChange(false);
                if (e.key === "Enter" && filtered.length > 0) {
                  onSelect(filtered[0]);
                }
              }}
              placeholder="Search branches..."
              className="h-7 text-sm font-mono px-2 py-0"
            />
          </div>
          <div className="max-h-48 overflow-y-auto p-1">
            {filtered.length === 0 ? (
              <p className="text-xs text-muted-foreground px-2 py-1.5">No branches found</p>
            ) : (
              filtered.map((branch) => (
                <button
                  key={branch}
                  onClick={() => onSelect(branch)}
                  className={`w-full text-left text-sm font-mono px-2 py-1.5 rounded-sm hover:bg-accent hover:text-accent-foreground transition-colors truncate ${
                    branch === value ? "bg-accent/50 text-accent-foreground" : ""
                  }`}
                >
                  {branch}
                </button>
              ))
            )}
          </div>
        </div>
      )}
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
