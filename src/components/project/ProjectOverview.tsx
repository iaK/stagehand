import { useEffect, useState } from "react";
import { useTaskStore } from "../../stores/taskStore";
import { useProjectStore } from "../../stores/projectStore";
import { useProjectOverviewStore } from "../../stores/projectOverviewStore";
import { useGitHubStore } from "../../stores/githubStore";
import { useLinearStore } from "../../stores/linearStore";
import { AVAILABLE_AGENTS } from "../../lib/agents";
import * as repo from "../../lib/repositories";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from "@/components/ui/collapsible";
import { pipelineColors } from "../../lib/taskStatus";
import { ChevronDown } from "lucide-react";
import { formatRelativeTime, formatTokenCount, formatDuration, formatCost } from "../../lib/format";
import { gitDiffShortStatBranch } from "../../lib/git";
import { getTaskWorkingDir } from "../../lib/worktree";

export function ProjectOverview() {
  const activeProject = useProjectStore((s) => s.activeProject);
  const tasks = useTaskStore((s) => s.tasks);
  const taskExecStatuses = useTaskStore((s) => s.taskExecStatuses);
  const setActiveTask = useTaskStore((s) => s.setActiveTask);

  const archivedTasks = useProjectOverviewStore((s) => s.archivedTasks);
  const tokenUsage = useProjectOverviewStore((s) => s.tokenUsage);
  const tokenUsageToday = useProjectOverviewStore((s) => s.tokenUsageToday);
  const loading = useProjectOverviewStore((s) => s.loading);
  const loadProjectOverview = useProjectOverviewStore((s) => s.loadProjectOverview);

  const githubRepoFullName = useGitHubStore((s) => s.repoFullName);
  const githubLoading = useGitHubStore((s) => s.loading);
  const linearApiKey = useLinearStore((s) => s.apiKey);
  const linearUserName = useLinearStore((s) => s.userName);
  const linearOrgName = useLinearStore((s) => s.orgName);

  const defaultBranch = useGitHubStore((s) => s.defaultBranch);

  const [defaultAgent, setDefaultAgent] = useState<string | null>(null);
  const [archivedOpen, setArchivedOpen] = useState(false);
  const [taskDiffStats, setTaskDiffStats] = useState<Record<string, { insertions: number; deletions: number }>>({});

  useEffect(() => {
    if (activeProject) {
      loadProjectOverview(activeProject.id);
      repo.getProjectSetting(activeProject.id, "default_agent").then((val) => {
        setDefaultAgent(val ?? "claude");
      });
    }
  }, [activeProject?.id, loadProjectOverview]);

  // Auto-expand archived if no active tasks
  useEffect(() => {
    if (tasks.length === 0 && archivedTasks.length > 0) {
      setArchivedOpen(true);
    }
  }, [tasks.length, archivedTasks.length]);

  useEffect(() => {
    if (!activeProject || !defaultBranch || tasks.length === 0) {
      setTaskDiffStats({});
      return;
    }

    let cancelled = false;

    const fetchAll = async () => {
      const results: Record<string, { insertions: number; deletions: number }> = {};
      await Promise.all(
        tasks.map(async (task) => {
          if (!task.branch_name) return;
          try {
            const workDir = getTaskWorkingDir(task, activeProject.path);
            const stats = await gitDiffShortStatBranch(workDir, defaultBranch);
            results[task.id] = { insertions: stats.insertions, deletions: stats.deletions };
          } catch {
            // Worktree may be gone — skip
          }
        }),
      );
      if (!cancelled) setTaskDiffStats(results);
    };

    fetchAll();
    return () => { cancelled = true; };
  }, [activeProject?.path, defaultBranch, tasks]);

  if (!activeProject) return null;

  const awaitingTasks = tasks.filter((t) => taskExecStatuses[t.id] === "awaiting_user");
  const sortedTasks = [...tasks].sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime());

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-6 min-h-full">
      {/* Project Header */}
      <div>
        <h1 className="text-xl font-semibold">{activeProject.name}</h1>
        <p className="text-sm text-muted-foreground font-mono mt-0.5">{activeProject.path}</p>
      </div>

      {/* Stats Summary */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard
          label="Active Tasks"
          value={String(tasks.length)}
        />
        <StatCard
          label="Archived Tasks"
          value={loading ? undefined : String(archivedTasks.length)}
          loading={loading}
        />
        <StatCard
          label="Total Cost"
          value={loading ? undefined : tokenUsage ? formatCost(tokenUsage.total_cost_usd) : "$0.00"}
          loading={loading}
        />
        <StatCard
          label="Today"
          value={loading ? undefined : tokenUsageToday ? formatTokenCount(tokenUsageToday.input_tokens + tokenUsageToday.output_tokens) + " tokens" : "0 tokens"}
          sub={loading ? undefined : tokenUsageToday ? formatCost(tokenUsageToday.total_cost_usd) : undefined}
          loading={loading}
        />
      </div>

      {/* Integrations & Agent */}
      <div className="grid grid-cols-3 gap-4">
        <div className="rounded-lg border border-border bg-card px-4 py-3">
          <span className="text-xs text-muted-foreground">GitHub</span>
          {githubLoading ? (
            <Skeleton className="h-5 w-24 mt-1" />
          ) : githubRepoFullName ? (
            <div className="flex items-center gap-2 mt-1">
              <span className="w-2 h-2 rounded-full bg-green-500 shrink-0" />
              <p className="text-sm font-medium truncate">{githubRepoFullName}</p>
            </div>
          ) : (
            <div className="flex items-center gap-2 mt-1">
              <span className="w-2 h-2 rounded-full bg-zinc-400 shrink-0" />
              <p className="text-sm text-muted-foreground">Not connected</p>
            </div>
          )}
        </div>
        <div className="rounded-lg border border-border bg-card px-4 py-3">
          <span className="text-xs text-muted-foreground">Linear</span>
          {linearApiKey ? (
            <div className="flex items-center gap-2 mt-1">
              <span className="w-2 h-2 rounded-full bg-green-500 shrink-0" />
              <p className="text-sm font-medium truncate">{linearUserName}{linearOrgName ? ` (${linearOrgName})` : ""}</p>
            </div>
          ) : (
            <div className="flex items-center gap-2 mt-1">
              <span className="w-2 h-2 rounded-full bg-zinc-400 shrink-0" />
              <p className="text-sm text-muted-foreground">Not connected</p>
            </div>
          )}
        </div>
        <div className="rounded-lg border border-border bg-card px-4 py-3">
          <span className="text-xs text-muted-foreground">Default Agent</span>
          {defaultAgent ? (
            <p className="text-sm font-medium mt-1">
              {AVAILABLE_AGENTS.find((a) => a.value === defaultAgent)?.label ?? defaultAgent}
            </p>
          ) : (
            <Skeleton className="h-5 w-16 mt-1" />
          )}
        </div>
      </div>

      {/* Tasks Requiring Attention */}
      {awaitingTasks.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Needs Attention</CardTitle>
          </CardHeader>
          <CardContent className="space-y-1">
            {awaitingTasks.map((task) => (
              <button
                key={task.id}
                onClick={() => setActiveTask(task)}
                className="w-full text-left flex items-center gap-2 px-3 py-2 rounded-md hover:bg-accent transition-colors"
              >
                <span className="w-2 h-2 rounded-full shrink-0 bg-amber-500" />
                <span className="text-sm truncate">{task.title}</span>
                <Badge variant="secondary" className="ml-auto text-[10px]">
                  Awaiting input
                </Badge>
              </button>
            ))}
          </CardContent>
        </Card>
      )}

      {/* Active Tasks List */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Active Tasks</CardTitle>
        </CardHeader>
        <CardContent>
          {sortedTasks.length === 0 ? (
            <p className="text-sm text-muted-foreground py-2">
              No active tasks. Create your first task to get started.
            </p>
          ) : (
            <div className="space-y-1">
              {sortedTasks.map((task) => (
                <TaskRow
                  key={task.id}
                  title={task.title}
                  updatedAt={task.updated_at}
                  dotClass={pipelineColors[taskExecStatuses[task.id]] ?? "bg-zinc-400"}
                  status={taskExecStatuses[task.id]}
                  insertions={taskDiffStats[task.id]?.insertions}
                  deletions={taskDiffStats[task.id]?.deletions}
                  onClick={() => setActiveTask(task)}
                />
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Archived Tasks (Collapsible) */}
      {archivedTasks.length > 0 && (
        <Collapsible open={archivedOpen} onOpenChange={setArchivedOpen}>
          <Card>
            <CardHeader className="pb-2">
              <CollapsibleTrigger className="flex items-center gap-2 w-full text-left">
                <CardTitle className="text-base">Archived Tasks ({archivedTasks.length})</CardTitle>
                <ChevronDown className={`w-4 h-4 text-muted-foreground transition-transform ${archivedOpen ? "rotate-180" : ""}`} />
              </CollapsibleTrigger>
            </CardHeader>
            <CollapsibleContent>
              <CardContent className="space-y-1">
                {archivedTasks.map((task) => (
                  <TaskRow
                    key={task.id}
                    title={task.title}
                    updatedAt={task.updated_at}
                    dotClass="bg-zinc-400"
                    muted
                    disabled
                  />
                ))}
              </CardContent>
            </CollapsibleContent>
          </Card>
        </Collapsible>
      )}

      {/* Token Usage Details */}
      {tokenUsage && tokenUsage.execution_count > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Token Usage</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <span className="text-xs text-muted-foreground">Input Tokens</span>
                <p className="text-sm font-medium">{formatTokenCount(tokenUsage.input_tokens)}</p>
              </div>
              <div>
                <span className="text-xs text-muted-foreground">Output Tokens</span>
                <p className="text-sm font-medium">{formatTokenCount(tokenUsage.output_tokens)}</p>
              </div>
              <div>
                <span className="text-xs text-muted-foreground">Cache Read</span>
                <p className="text-sm font-medium">{formatTokenCount(tokenUsage.cache_read_input_tokens)}</p>
              </div>
              <div>
                <span className="text-xs text-muted-foreground">Cache Creation</span>
                <p className="text-sm font-medium">{formatTokenCount(tokenUsage.cache_creation_input_tokens)}</p>
              </div>
              <div>
                <span className="text-xs text-muted-foreground">Total Cost</span>
                <p className="text-sm font-medium">{formatCost(tokenUsage.total_cost_usd)}</p>
              </div>
              <div>
                <span className="text-xs text-muted-foreground">Total Duration</span>
                <p className="text-sm font-medium">{formatDuration(tokenUsage.duration_ms)}</p>
              </div>
              <div>
                <span className="text-xs text-muted-foreground">Total Turns</span>
                <p className="text-sm font-medium">{tokenUsage.num_turns.toLocaleString()}</p>
              </div>
              <div>
                <span className="text-xs text-muted-foreground">Executions</span>
                <p className="text-sm font-medium">{tokenUsage.execution_count.toLocaleString()}</p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function StatCard({ label, value, sub, loading }: { label: string; value?: string; sub?: string; loading?: boolean }) {
  return (
    <div className="rounded-lg border border-border bg-card px-4 py-3">
      <span className="text-xs text-muted-foreground">{label}</span>
      {loading ? (
        <Skeleton className="h-5 w-16 mt-1" />
      ) : (
        <>
          <p className="text-lg font-semibold">{value}</p>
          {sub && <p className="text-xs text-muted-foreground">{sub}</p>}
        </>
      )}
    </div>
  );
}

function TaskRow({
  title,
  updatedAt,
  dotClass,
  status,
  insertions,
  deletions,
  muted,
  disabled,
  onClick,
}: {
  title: string;
  updatedAt: string;
  dotClass: string;
  status?: string;
  insertions?: number;
  deletions?: number;
  muted?: boolean;
  disabled?: boolean;
  onClick?: () => void;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`w-full text-left flex items-center gap-2 px-3 py-2 rounded-md transition-colors ${muted ? "opacity-60" : ""} ${disabled ? "cursor-default" : "hover:bg-accent"}`}
    >
      <span className={`w-2 h-2 rounded-full shrink-0 ${dotClass}`} />
      <span className="text-sm truncate">{title}</span>
      {insertions != null && (
        <span className="text-xs font-mono shrink-0">
          <span className="text-green-600">+{insertions}</span>
          {" "}
          <span className="text-red-600">-{deletions}</span>
        </span>
      )}
      <span className={`text-xs text-muted-foreground shrink-0 ${insertions == null ? "ml-auto" : ""}`}>
        {formatRelativeTime(updatedAt)}
      </span>
      {status && (
        <Badge variant="secondary" className="text-[10px] shrink-0">
          {status.replace(/_/g, " ")}
        </Badge>
      )}
    </button>
  );
}
