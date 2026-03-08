import { useState, useEffect, useMemo, useRef } from "react";
import { useTaskStore } from "../../stores/taskStore";
import { useProjectStore } from "../../stores/projectStore";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip";
import { AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle, AlertDialogDescription, AlertDialogFooter, AlertDialogCancel, AlertDialogAction } from "@/components/ui/alert-dialog";
import { Textarea } from "@/components/ui/textarea";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Loader2 } from "lucide-react";
import {
  gitLog,
  gitLogBranchDiff,
  gitListBranches,
  gitDiffShortStatBranch,
  hasUncommittedChanges,
  gitAdd,
  gitCommit,
  gitDiffStat,
  gitStash,
  gitStashPop,
  gitFetch,
  gitMerge,
  ejectTaskToMainRepo,
  injectTaskFromMainRepo,
  type GitCommit,
} from "../../lib/git";
import { sendNotification } from "../../lib/notifications";
import { toast } from "sonner";
import { useProcessStore } from "../../stores/processStore";
import { useGitHubStore } from "../../stores/githubStore";
import { useProjectOverviewStore } from "../../stores/projectOverviewStore";
import { getTaskWorkingDir, cleanupTaskWorktree } from "../../lib/worktree";
import * as repo from "../../lib/repositories";
import { statusColors } from "../../lib/taskStatus";
import { TaskCreate } from "./TaskCreate";
import type { Task, StageExecution } from "../../lib/types";

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
  split: { label: "Split", variant: "info" },
};

export function TaskOverview() {
  const activeTask = useTaskStore((s) => s.activeTask);
  const executions = useTaskStore((s) => s.executions);
  const activeProject = useProjectStore((s) => s.activeProject);
  const defaultBranch = useGitHubStore((s) => s.defaultBranch);
  const setDefaultBranch = useGitHubStore((s) => s.setDefaultBranch);
  const commitVersion = useProcessStore((s) => s.commitVersion);

  const setActiveTask = useTaskStore((s) => s.setActiveTask);
  const updateTask = useTaskStore((s) => s.updateTask);

  const [commits, setCommits] = useState<GitCommit[]>([]);
  const [commitsLoading, setCommitsLoading] = useState(true);
  const [showTokenDetails, setShowTokenDetails] = useState(false);
  const [branchPickerOpen, setBranchPickerOpen] = useState(false);
  const [branches, setBranches] = useState<string[]>([]);
  const [childTasks, setChildTasks] = useState<Task[]>([]);
  const [parentTask, setParentTask] = useState<Task | null>(null);
  const [diffStats, setDiffStats] = useState<{ insertions: number; deletions: number } | null>(null);
  const [archiveDialogOpen, setArchiveDialogOpen] = useState(false);
  const [editingTask, setEditingTask] = useState(false);

  // Eject/Inject state
  const [ejectDialogOpen, setEjectDialogOpen] = useState(false);
  const [injectDialogOpen, setInjectDialogOpen] = useState(false);
  const [ejecting, setEjecting] = useState(false);
  const [injecting, setInjecting] = useState(false);
  const [ejectError, setEjectError] = useState<string | null>(null);
  const [injectError, setInjectError] = useState<string | null>(null);
  const [worktreeHasChanges, setWorktreeHasChanges] = useState(false);
  const [mainRepoHasChanges, setMainRepoHasChanges] = useState(false);
  const [ejectCommitMessage, setEjectCommitMessage] = useState("");
  const [ejectDiffStat, setEjectDiffStat] = useState("");
  const [checkingChanges, setCheckingChanges] = useState(false);

  // Merge state
  const [mergeDialogOpen, setMergeDialogOpen] = useState(false);
  const [merging, setMerging] = useState(false);
  const [mergeError, setMergeError] = useState<string | null>(null);
  const [mergeSuccess, setMergeSuccess] = useState(false);

  const isAnyStageRunning = useProcessStore((s) => {
    if (!activeTask) return false;
    return Object.entries(s.stages).some(
      ([key, state]) => key.startsWith(`${activeTask.id}:`) && state.isRunning,
    );
  });

  useEffect(() => {
    if (activeTask?.status !== "split" || !activeProject) {
      setChildTasks([]);
      return;
    }
    let cancelled = false;
    repo.getChildTasks(activeProject.id, activeTask.id).then((tasks) => {
      if (!cancelled) setChildTasks(tasks);
    });
    return () => { cancelled = true; };
  }, [activeTask?.id, activeTask?.status, activeProject?.id]);

  useEffect(() => {
    if (!activeTask?.parent_task_id || !activeProject) {
      setParentTask(null);
      return;
    }
    let cancelled = false;
    repo.getTask(activeProject.id, activeTask.parent_task_id)
      .then((task) => { if (!cancelled) setParentTask(task); })
      .catch(() => { if (!cancelled) setParentTask(null); });
    return () => { cancelled = true; };
  }, [activeTask?.id, activeTask?.parent_task_id, activeProject?.id]);

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

  const taskStageInstances = useTaskStore((s) => s.getActiveTaskStageInstances)();
  const perStageUsage = useMemo(() => {
    if (!tokenTotals) return [];
    const byStage = new Map<string, StageExecution>();
    for (const exec of executions) {
      if (exec.total_cost_usd == null) continue;
      const key = exec.task_stage_id ?? exec.task_id;
      const existing = byStage.get(key);
      if (!existing || exec.attempt_number > existing.attempt_number) {
        byStage.set(key, exec);
      }
    }
    return taskStageInstances
      .filter((t) => byStage.has(t.task_stage_id))
      .map((t) => ({ stage: t, execution: byStage.get(t.task_stage_id)! }));
  }, [executions, taskStageInstances, tokenTotals]);

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
  }, [activeTask?.id, activeProject?.path, defaultBranch, commitVersion]);

  useEffect(() => {
    if (!activeTask || !activeProject || !defaultBranch) {
      setDiffStats(null);
      return;
    }

    let cancelled = false;
    const workDir = getTaskWorkingDir(activeTask, activeProject.path);

    gitDiffShortStatBranch(workDir, defaultBranch)
      .then((stats) => {
        if (!cancelled) setDiffStats(stats);
        // Persist diff stats so they survive after merge/cleanup
        if (activeProject && activeTask &&
            (activeTask.diff_insertions !== stats.insertions || activeTask.diff_deletions !== stats.deletions)) {
          repo.updateTask(activeProject.id, activeTask.id, {
            diff_insertions: stats.insertions,
            diff_deletions: stats.deletions,
          }).catch(() => {});
        }
      })
      .catch(() => {
        if (!cancelled) setDiffStats(null);
      });

    return () => { cancelled = true; };
  }, [activeTask?.id, activeProject?.path, defaultBranch, commitVersion]);

  const confirmArchive = async () => {
    if (!activeProject || !activeTask) return;
    await cleanupTaskWorktree(activeProject.path, activeTask, {
      deleteBranch: true,
      defaultBranch: defaultBranch ?? undefined,
    });
    await updateTask(activeProject.id, activeTask.id, { lifecycle: "archived" });
    sendNotification("Task archived", activeTask.title, "success", { projectId: activeProject.id, taskId: activeTask.id });
    setArchiveDialogOpen(false);
    setActiveTask(null);
  };

  const handleEjectClick = async () => {
    if (!activeProject || !activeTask?.worktree_path || !activeTask?.branch_name) return;
    setCheckingChanges(true);
    setEjectError(null);
    setWorktreeHasChanges(false);
    setMainRepoHasChanges(false);
    setEjectCommitMessage("");
    setEjectDiffStat("");

    try {
      // Check if another task is already ejected
      const allTasks = useTaskStore.getState().tasks;
      const alreadyEjected = allTasks.find(
        (t) => t.id !== activeTask.id && t.ejected === 1,
      );
      if (alreadyEjected) {
        setEjectError(
          `Task "${alreadyEjected.title}" is currently ejected. Only one task can be ejected at a time. Inject it back first.`,
        );
        setEjectDialogOpen(true);
        setCheckingChanges(false);
        return;
      }

      // Check main repo for uncommitted changes
      const mainDirty = await hasUncommittedChanges(activeProject.path);
      if (mainDirty) {
        setMainRepoHasChanges(true);
      }

      // Check worktree for uncommitted changes
      const worktreeDirty = await hasUncommittedChanges(activeTask.worktree_path);
      if (worktreeDirty) {
        setWorktreeHasChanges(true);
        const stat = await gitDiffStat(activeTask.worktree_path).catch(() => "");
        setEjectDiffStat(stat);
        const prefix = await repo.getCommitPrefix(activeProject.id).catch(() => "feat");
        setEjectCommitMessage(`${prefix}: ${activeTask.branch_name}`);
      }
    } catch (err) {
      setEjectError(err instanceof Error ? err.message : String(err));
    }

    setCheckingChanges(false);
    setEjectDialogOpen(true);
  };

  const handleEjectConfirm = async () => {
    if (!activeProject || !activeTask?.worktree_path || !activeTask?.branch_name) return;
    setEjecting(true);
    setEjectError(null);
    try {
      if (worktreeHasChanges) {
        await gitAdd(activeTask.worktree_path);
        await gitCommit(activeTask.worktree_path, ejectCommitMessage);
      }
      if (mainRepoHasChanges) {
        await gitStash(activeProject.path);
      }
      await ejectTaskToMainRepo(
        activeProject.path,
        activeTask.worktree_path,
        activeTask.branch_name,
      );
      if (mainRepoHasChanges) {
        await gitStashPop(activeProject.path);
      }
      await repo.updateTask(activeProject.id, activeTask.id, {
        ejected: 1,
        worktree_path: null,
      });
      await useTaskStore.getState().loadTasks(activeProject.id);
      sendNotification("Task ejected", "Branch checked out in main repo", "success", {
        projectId: activeProject.id,
        taskId: activeTask.id,
      });
      setEjectDialogOpen(false);
      setWorktreeHasChanges(false);
      setMainRepoHasChanges(false);
      setEjectCommitMessage("");
      setEjectDiffStat("");
    } catch (err) {
      setEjectError(err instanceof Error ? err.message : String(err));
    } finally {
      setEjecting(false);
    }
  };

  const handleInjectConfirm = async () => {
    if (!activeProject || !activeTask?.branch_name) return;
    setInjecting(true);
    setInjectError(null);
    try {
      const mainDirty = await hasUncommittedChanges(activeProject.path);
      if (mainDirty) {
        setInjectError(
          "Your main project directory has uncommitted changes. Please commit or stash them before injecting back.",
        );
        setInjecting(false);
        return;
      }

      const worktreePath = `${activeProject.path}/.stagehand-worktrees/${activeTask.branch_name.replace(/\//g, "--")}`;
      await injectTaskFromMainRepo(
        activeProject.path,
        worktreePath,
        activeTask.branch_name,
        defaultBranch ?? undefined,
      );
      await repo.updateTask(activeProject.id, activeTask.id, {
        ejected: 0,
        worktree_path: worktreePath,
      });
      await useTaskStore.getState().loadTasks(activeProject.id);
      sendNotification("Task injected", "Branch moved back to worktree", "success", {
        projectId: activeProject.id,
        taskId: activeTask.id,
      });
      setInjectDialogOpen(false);
    } catch (err) {
      setInjectError(err instanceof Error ? err.message : String(err));
    } finally {
      setInjecting(false);
    }
  };

  const handleMergeTargetBranch = async () => {
    const workDir = activeTask && activeProject
      ? getTaskWorkingDir(activeTask, activeProject.path)
      : null;
    const target = defaultBranch ?? "main";
    if (!workDir) return;
    setMerging(true);
    setMergeError(null);
    setMergeSuccess(false);
    try {
      await gitFetch(workDir, target);
      await gitMerge(workDir, `origin/${target}`);
      setMergeSuccess(true);
    } catch (err) {
      setMergeError(err instanceof Error ? err.message : String(err));
    } finally {
      setMerging(false);
    }
  };

  if (!activeTask) return null;

  const status = statusConfig[activeTask.status] ?? statusConfig.pending;
  const currentStage = activeTask.current_stage_id
    ? taskStageInstances.find((s) => s.task_stage_id === activeTask.current_stage_id)
    : null;

  return (
    <>
      {/* Fixed header bar — aligned with pipeline stepper and sidebar header */}
      <div className="flex items-center px-4 h-[57px] shrink-0">
        <Badge variant={status.variant}>{status.label}</Badge>
        <div className="ml-auto flex items-center gap-1">
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon-xs"
              className="shrink-0"
              onClick={() => {
                navigator.clipboard.writeText(activeTask.title);
              }}
            >
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
              </svg>
            </Button>
          </TooltipTrigger>
          <TooltipContent>Copy name</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon-xs"
              onClick={() => setEditingTask(true)}
            >
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
              </svg>
            </Button>
          </TooltipTrigger>
          <TooltipContent>Edit task</TooltipContent>
        </Tooltip>
        {activeTask.branch_name && (
          activeTask.ejected ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon-xs"
                  onClick={() => setInjectDialogOpen(true)}
                  disabled={isAnyStageRunning}
                >
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M19 14l-7 7m0 0l-7-7m7 7V3" />
                  </svg>
                </Button>
              </TooltipTrigger>
              <TooltipContent>Inject back to worktree</TooltipContent>
            </Tooltip>
          ) : (
            <Tooltip>
              <TooltipTrigger asChild>
                <span title={!activeTask.worktree_path ? "Run a pipeline stage first to create the worktree" : undefined}>
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    onClick={handleEjectClick}
                    disabled={isAnyStageRunning || !activeTask.worktree_path || checkingChanges}
                  >
                    {checkingChanges ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M5 10l7-7m0 0l7 7m-7-7v18" />
                      </svg>
                    )}
                  </Button>
                </span>
              </TooltipTrigger>
              <TooltipContent>Eject to main repo</TooltipContent>
            </Tooltip>
          )
        )}
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon-xs"
              disabled={isAnyStageRunning}
              onClick={async () => {
                if (!activeProject || !activeTask) return;
                await updateTask(activeProject.id, activeTask.id, { lifecycle: "paused" });
                useProjectOverviewStore.getState().loadProjectOverview(activeProject.id);
                sendNotification("Task paused", activeTask.title, "info", { projectId: activeProject.id, taskId: activeTask.id });
                setActiveTask(null);
              }}
            >
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 9v6m4-6v6m7-3a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </Button>
          </TooltipTrigger>
          <TooltipContent>Pause task</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon-xs"
              onClick={() => setArchiveDialogOpen(true)}
            >
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 8h14M5 8a2 2 0 110-4h14a2 2 0 110 4M5 8v10a2 2 0 002 2h10a2 2 0 002-2V8m-9 4h4" />
              </svg>
            </Button>
          </TooltipTrigger>
          <TooltipContent>Archive task</TooltipContent>
        </Tooltip>
        </div>
      </div>

      {/* Scrollable content */}
      <div className="flex-1 overflow-y-auto pt-0 px-6 pb-6 space-y-4">
      {/* Title */}
      <div className="space-y-2">
        {parentTask && (
          <button
            onClick={() => useTaskStore.getState().setActiveTask(parentTask)}
            className="text-xs text-muted-foreground hover:text-foreground transition-colors flex items-center gap-1"
          >
            <span>&larr;</span> Parent: {parentTask.title}
          </button>
        )}
        <h1 className="text-xl font-semibold truncate">{activeTask.title}</h1>
      </div>

      {/* Task Info */}
      <div className="rounded-lg border border-border bg-card px-4 py-3 space-y-3">
        <div className="grid grid-cols-2 gap-4">
          <div>
            <span className="text-xs text-muted-foreground">Started</span>
            <p className="text-sm font-medium">{formatDate(activeTask.created_at)}</p>
          </div>
          <div>
            <span className="text-xs text-muted-foreground">Current Stage</span>
            <p className="text-sm font-medium">{currentStage?.name ?? "Not started"}</p>
          </div>
        </div>
        {activeTask.status === "completed" && (
          <div>
            <span className="text-xs text-muted-foreground">Finished</span>
            <p className="text-sm font-medium">{formatDate(activeTask.updated_at)}</p>
          </div>
        )}
      </div>

      {/* Git Info */}
      <div className="rounded-lg border border-border bg-card px-4 py-3 space-y-3">
        <div>
          <span className="text-xs text-muted-foreground">Branch</span>
          <div className="flex items-center gap-2 text-sm font-medium font-mono mt-0.5">
            {activeTask.branch_name ? (
              <button
                className="truncate hover:text-blue-600 transition-colors text-left"
                onClick={() => {
                  navigator.clipboard.writeText(activeTask.branch_name!);
                  toast.success("Branch name copied");
                }}
              >
                {activeTask.branch_name}
              </button>
            ) : (
              <span className="truncate">No branch</span>
            )}
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
            {activeTask.branch_name && activeTask.worktree_path && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    className="text-muted-foreground hover:text-foreground transition-colors shrink-0 ml-auto disabled:opacity-40 disabled:pointer-events-none"
                    onClick={() => {
                      setMergeError(null);
                      setMergeSuccess(false);
                      setMergeDialogOpen(true);
                    }}
                    disabled={isAnyStageRunning}
                  >
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M7 16V4m0 0L3 8m4-4l4 4m6 0v12m0 0l4-4m-4 4l-4-4" />
                    </svg>
                  </button>
                </TooltipTrigger>
                <TooltipContent>Merge {defaultBranch ?? "main"} into branch</TooltipContent>
              </Tooltip>
            )}
          </div>
        </div>
        {activeTask.ejected === 1 && (
          <div>
            <span className="text-xs text-muted-foreground">Status</span>
            <p className="text-sm font-medium">Ejected to main repo</p>
          </div>
        )}
        {(activeTask.pr_url || (() => {
          const ins = diffStats?.insertions ?? activeTask.diff_insertions;
          const del = diffStats?.deletions ?? activeTask.diff_deletions;
          return ins != null && (ins !== 0 || del !== 0);
        })()) && (
          <div className="grid grid-cols-2 gap-4">
            {activeTask.pr_url && (
              <div>
                <span className="text-xs text-muted-foreground">Pull Request</span>
                <a
                  href={activeTask.pr_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-sm text-blue-600 hover:underline truncate block"
                >
                  {activeTask.pr_url.replace(/^https?:\/\//, "")}
                </a>
              </div>
            )}
            {(() => {
              const ins = diffStats?.insertions ?? activeTask.diff_insertions;
              const del = diffStats?.deletions ?? activeTask.diff_deletions;
              if (ins == null || (ins === 0 && del === 0)) return null;
              return (
                <div>
                  <span className="text-xs text-muted-foreground">Lines Changed</span>
                  <p className="text-sm font-medium font-mono mt-0.5">
                    <span className="text-green-600">+{ins}</span>
                    {" / "}
                    <span className="text-red-600">-{del}</span>
                  </p>
                </div>
              );
            })()}
          </div>
        )}
      </div>

      {activeTask.status === "split" && childTasks.length > 0 && (
        <>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Subtasks ({childTasks.length})</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {childTasks.map((child) => (
                <button
                  key={child.id}
                  onClick={() => useTaskStore.getState().setActiveTask(child)}
                  className="w-full text-left flex items-center gap-2 px-3 py-2 rounded-md hover:bg-accent transition-colors"
                >
                  <span className={`w-2 h-2 rounded-full shrink-0 ${statusColors[child.status] ?? "bg-zinc-400"}`} />
                  <span className="text-sm truncate">{child.title}</span>
                  <Badge variant="secondary" className="ml-auto text-xs">
                    {child.status}
                  </Badge>
                </button>
              ))}
            </CardContent>
          </Card>
        </>
      )}

      {/* Token Usage */}
      {tokenTotals && (
        <>
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
                            <tr key={stage.task_stage_id} className="border-b border-border/50">
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

      {/* Eject Confirmation Dialog */}
      <AlertDialog
        open={ejectDialogOpen}
        onOpenChange={(open) => {
          if (!open) {
            setEjectDialogOpen(false);
            setEjectError(null);
            setWorktreeHasChanges(false);
            setMainRepoHasChanges(false);
          }
        }}
      >
        <AlertDialogContent className="max-h-[85vh] overflow-y-auto">
          <AlertDialogHeader>
            <AlertDialogTitle>Eject to Main Repo</AlertDialogTitle>
            <AlertDialogDescription>
              This will check out the{" "}
              <code className="px-1 py-0.5 rounded bg-muted text-xs">
                {activeTask.branch_name}
              </code>{" "}
              branch in your main project directory so you can edit and test with
              your normal tools. The Stagehand pipeline will be paused until you
              inject back.
            </AlertDialogDescription>
          </AlertDialogHeader>

          {ejectError && (
            <Alert variant="destructive">
              <AlertDescription>{ejectError}</AlertDescription>
            </Alert>
          )}

          {mainRepoHasChanges && !ejectError && (
            <Alert>
              <AlertDescription>
                Your main repo has uncommitted changes. They will be stashed
                before ejecting and restored on the ejected branch.
              </AlertDescription>
            </Alert>
          )}

          {worktreeHasChanges && !ejectError && (
            <div className="space-y-3">
              <Alert>
                <AlertDescription>
                  The worktree has uncommitted changes that need to be committed
                  before ejecting.
                </AlertDescription>
              </Alert>
              {ejectDiffStat && (
                <pre className="text-xs bg-muted p-2 rounded max-h-40 overflow-y-auto whitespace-pre-wrap break-all">
                  {ejectDiffStat}
                </pre>
              )}
              <Textarea
                value={ejectCommitMessage}
                onChange={(e) => setEjectCommitMessage(e.target.value)}
                placeholder="Commit message..."
                rows={2}
              />
            </div>
          )}

          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            {!ejectError && (
              <Button
                onClick={handleEjectConfirm}
                disabled={
                  ejecting ||
                  (worktreeHasChanges && !ejectCommitMessage.trim())
                }
              >
                {ejecting && <Loader2 className="w-4 h-4 mr-1.5 animate-spin" />}
                {ejecting
                  ? worktreeHasChanges
                    ? "Committing & Ejecting..."
                    : mainRepoHasChanges
                      ? "Stashing & Ejecting..."
                      : "Ejecting..."
                  : worktreeHasChanges
                    ? "Commit & Eject"
                    : mainRepoHasChanges
                      ? "Stash & Eject"
                      : "Eject"}
              </Button>
            )}
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Inject Confirmation Dialog */}
      <AlertDialog
        open={injectDialogOpen}
        onOpenChange={(open) => {
          if (!open) {
            setInjectDialogOpen(false);
            setInjectError(null);
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Inject Back to Worktree</AlertDialogTitle>
            <AlertDialogDescription>
              This will move the{" "}
              <code className="px-1 py-0.5 rounded bg-muted text-xs">
                {activeTask.branch_name}
              </code>{" "}
              branch back to a worktree so Stagehand can resume the pipeline.
              Make sure you've committed any changes you want to keep.
            </AlertDialogDescription>
          </AlertDialogHeader>
          {injectError && (
            <Alert variant="destructive">
              <AlertDescription>{injectError}</AlertDescription>
            </Alert>
          )}
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <Button onClick={handleInjectConfirm} disabled={injecting}>
              {injecting && <Loader2 className="w-4 h-4 mr-1.5 animate-spin" />}
              {injecting ? "Injecting..." : "Inject"}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Archive Confirmation Dialog */}
      <AlertDialog open={archiveDialogOpen} onOpenChange={(open) => !open && setArchiveDialogOpen(false)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Archive Task</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to archive <span className="font-medium text-foreground">"{activeTask.title}"</span>?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={confirmArchive}>
              Archive
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Merge Target Branch Dialog */}
      <AlertDialog open={mergeDialogOpen} onOpenChange={(open) => { if (!open) setMergeDialogOpen(false); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Merge Target Branch</AlertDialogTitle>
            <AlertDialogDescription>
              This will fetch and merge{" "}
              <code className="px-1 py-0.5 rounded bg-muted text-xs">
                origin/{defaultBranch ?? "main"}
              </code>{" "}
              into your current task branch. This is useful to pull in upstream changes.
            </AlertDialogDescription>
          </AlertDialogHeader>

          {mergeError && (
            <Alert variant="destructive">
              <AlertDescription className="whitespace-pre-wrap text-xs">{mergeError}</AlertDescription>
            </Alert>
          )}

          {mergeSuccess && (
            <Alert>
              <AlertDescription>Merge completed successfully.</AlertDescription>
            </Alert>
          )}

          <AlertDialogFooter>
            <AlertDialogCancel>
              {mergeSuccess ? "Done" : "Cancel"}
            </AlertDialogCancel>
            {!mergeSuccess && (
              <Button onClick={handleMergeTargetBranch} disabled={merging}>
                {merging && <Loader2 className="w-4 h-4 mr-1.5 animate-spin" />}
                {merging ? "Merging..." : "Merge"}
              </Button>
            )}
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Edit Task Modal */}
      {editingTask && activeProject && (
        <TaskCreate
          projectId={activeProject.id}
          task={activeTask}
          onClose={() => setEditingTask(false)}
        />
      )}
    </div>
    </>
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
    <div className="relative shrink-0 flex items-center gap-1" ref={containerRef}>
      <button
        className="hover:text-blue-600 transition-colors text-left truncate"
        onClick={() => {
          navigator.clipboard.writeText(value);
          toast.success("Target branch copied");
        }}
      >
        {value}
      </button>
      <button
        onClick={() => onOpenChange(!open)}
        className="text-muted-foreground hover:text-foreground transition-colors shrink-0"
        title="Change target branch"
      >
        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
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

