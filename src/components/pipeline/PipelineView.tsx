import { useState, useEffect, useMemo } from "react";
import { useTaskStore } from "../../stores/taskStore";
import { useProjectStore } from "../../stores/projectStore";
import { useProcessStore, stageKey } from "../../stores/processStore";
import { PipelineStepper } from "./PipelineStepper";
import { StageView } from "./StageView";
import { TaskOverview } from "../task/TaskOverview";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogCancel,
} from "@/components/ui/alert-dialog";
import { Textarea } from "@/components/ui/textarea";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Loader2 } from "lucide-react";
import {
  hasUncommittedChanges,
  gitAdd,
  gitCommit,
  gitDiffStat,
  ejectTaskToMainRepo,
  injectTaskFromMainRepo,
} from "../../lib/git";
import { updateTask as repoUpdateTask, getCommitPrefix } from "../../lib/repositories";
import { sendNotification } from "../../lib/notifications";
import { logger } from "../../lib/logger";
import type { StageTemplate } from "../../lib/types";

export function PipelineView() {
  const activeProject = useProjectStore((s) => s.activeProject);
  const activeTask = useTaskStore((s) => s.activeTask);
  const executions = useTaskStore((s) => s.executions);
  const loadExecutions = useTaskStore((s) => s.loadExecutions);
  const loadTaskStages = useTaskStore((s) => s.loadTaskStages);
  const stageTemplates = useTaskStore((s) => s.stageTemplates);
  const taskStages = useTaskStore((s) => s.taskStages);

  // Compute filtered stages from stable selectors
  const activeTaskId = activeTask?.id;
  const filteredStages = useMemo(() => {
    if (!activeTaskId) return stageTemplates;
    const selectedIds = taskStages[activeTaskId];
    if (!selectedIds || selectedIds.length === 0) {
      // During research stage (before user selects stages), only show the current stage
      const currentStage = stageTemplates.find(
        (t) => t.id === activeTask?.current_stage_id,
      );
      return currentStage ? [currentStage] : stageTemplates;
    }
    const idSet = new Set(selectedIds);
    return stageTemplates.filter((t) => idSet.has(t.id));
  }, [stageTemplates, taskStages, activeTaskId, activeTask?.current_stage_id]);

  const [viewingStage, setViewingStage] = useState<StageTemplate | null>(null);
  const [activeView, setActiveView] = useState<"overview" | "pipeline">("pipeline");

  // Track all tasks that have been viewed so their stages stay mounted (preserves PTY sessions)
  const [mountedTaskStages, setMountedTaskStages] = useState<Map<string, StageTemplate[]>>(new Map());

  // Eject/Inject state
  const [ejectDialogOpen, setEjectDialogOpen] = useState(false);
  const [injectDialogOpen, setInjectDialogOpen] = useState(false);
  const [ejecting, setEjecting] = useState(false);
  const [injecting, setInjecting] = useState(false);
  const [ejectError, setEjectError] = useState<string | null>(null);
  const [injectError, setInjectError] = useState<string | null>(null);
  const [worktreeHasChanges, setWorktreeHasChanges] = useState(false);
  const [ejectCommitMessage, setEjectCommitMessage] = useState("");
  const [ejectDiffStat, setEjectDiffStat] = useState("");
  const [checkingChanges, setCheckingChanges] = useState(false);

  const isAnyStageRunning = useProcessStore((s) => {
    if (!activeTask) return false;
    return Object.entries(s.stages).some(
      ([key, state]) => key.startsWith(`${activeTask.id}:`) && state.isRunning,
    );
  });

  const handleEjectClick = async () => {
    if (!activeProject || !activeTask?.worktree_path || !activeTask?.branch_name) return;
    setCheckingChanges(true);
    setEjectError(null);
    setWorktreeHasChanges(false);
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
        setEjectError(
          "Main repo has uncommitted changes. Please commit or stash them first.",
        );
        setEjectDialogOpen(true);
        setCheckingChanges(false);
        return;
      }

      // Check worktree for uncommitted changes
      const worktreeDirty = await hasUncommittedChanges(activeTask.worktree_path);
      if (worktreeDirty) {
        setWorktreeHasChanges(true);
        const stat = await gitDiffStat(activeTask.worktree_path).catch(() => "");
        setEjectDiffStat(stat);
        const prefix = await getCommitPrefix(activeProject.id).catch(() => "feat");
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
      await ejectTaskToMainRepo(
        activeProject.path,
        activeTask.worktree_path,
        activeTask.branch_name,
      );
      await repoUpdateTask(activeProject.id, activeTask.id, {
        ejected: 1,
        worktree_path: null,
      });
      // Refresh task store
      await useTaskStore.getState().loadTasks(activeProject.id);
      sendNotification("Task ejected", "Branch checked out in main repo", "success", {
        projectId: activeProject.id,
        taskId: activeTask.id,
      });
      setEjectDialogOpen(false);
      setWorktreeHasChanges(false);
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
      // Check main repo for uncommitted changes
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
      );
      await repoUpdateTask(activeProject.id, activeTask.id, {
        ejected: 0,
        worktree_path: worktreePath,
      });
      // Refresh task store
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

  // Stable primitive values for effect dependencies
  const projectId = activeProject?.id;
  const currentStageId = activeTask?.current_stage_id;

  // Load executions and task stages when task changes
  useEffect(() => {
    if (projectId && activeTaskId) {
      loadExecutions(projectId, activeTaskId).catch((err) =>
        logger.error("Failed to load executions:", err),
      );
      loadTaskStages(projectId, activeTaskId).catch((err) =>
        logger.error("Failed to load task stages:", err),
      );
    }
  }, [projectId, activeTaskId, loadExecutions, loadTaskStages]);

  // Auto-select current stage when it advances (approval, auto-start, task change)
  useEffect(() => {
    if (currentStageId && filteredStages.length > 0) {
      const current = filteredStages.find(
        (s) => s.id === currentStageId,
      );
      setViewingStage(current ?? filteredStages[0]);
    } else if (filteredStages.length > 0) {
      setViewingStage(filteredStages[0]);
    } else {
      setViewingStage(null);
    }
  }, [activeTaskId, currentStageId, filteredStages]);

  // Reset tab view when task changes
  useEffect(() => {
    setActiveView("pipeline");
  }, [activeTaskId]);

  // Keep mounted task stages in sync — add/update stages for the active task
  useEffect(() => {
    if (activeTaskId && filteredStages.length > 0) {
      setMountedTaskStages((prev) => {
        const next = new Map(prev);
        next.set(activeTaskId, filteredStages);
        return next;
      });
    }
  }, [activeTaskId, filteredStages]);

  // Sync viewed stage to process store so TerminalView can show the right output
  useEffect(() => {
    const sk = activeTaskId && viewingStage ? stageKey(activeTaskId, viewingStage.id) : null;
    useProcessStore.getState().setViewingStageId(sk);
  }, [viewingStage, activeTaskId]);

  // Placeholder screens when no project/task — rendered alongside (not instead of)
  // the mounted stages so that hidden terminals survive project/task switches.
  const showPlaceholder = !activeProject || !activeTask;

  return (
    <div className="flex flex-col h-full">
      {!activeProject && (
        <div className="flex-1 flex items-center justify-center h-full">
          <div className="text-center">
            <p className="text-muted-foreground text-lg">Welcome to Stagehand</p>
            <p className="text-muted-foreground/60 text-sm mt-2">
              Create a project to get started
            </p>
          </div>
        </div>
      )}

      {activeProject && !activeTask && (
        <div className="flex-1 flex items-center justify-center h-full">
          <p className="text-muted-foreground">Select or create a task to begin</p>
        </div>
      )}

      {/* Header bar */}
      <div className="border-b border-border flex items-center h-[57px]" style={{ display: showPlaceholder ? "none" : undefined }}>
        {/* Tab toggle */}
        <div className="flex items-center gap-1 px-4">
          <button
            onClick={() => setActiveView("overview")}
            className={`px-2.5 py-1 rounded text-xs font-medium transition-colors ${
              activeView === "overview"
                ? "bg-zinc-100 dark:bg-zinc-800 text-zinc-800 dark:text-zinc-200 border border-zinc-300 dark:border-zinc-600"
                : "text-zinc-400 dark:text-zinc-500 hover:text-zinc-600 dark:hover:text-zinc-400"
            }`}
          >
            Overview
          </button>
          <button
            onClick={() => setActiveView("pipeline")}
            className={`px-2.5 py-1 rounded text-xs font-medium transition-colors ${
              activeView === "pipeline"
                ? "bg-zinc-100 dark:bg-zinc-800 text-zinc-800 dark:text-zinc-200 border border-zinc-300 dark:border-zinc-600"
                : "text-zinc-400 dark:text-zinc-500 hover:text-zinc-600 dark:hover:text-zinc-400"
            }`}
          >
            Pipeline
          </button>
        </div>
        {activeView === "pipeline" && (
          <>
            <div className="w-px h-6 bg-border" />
            <PipelineStepper
              stages={filteredStages}
              currentStageId={currentStageId ?? null}
              executions={executions}
              onStageClick={setViewingStage}
            />
          </>
        )}
        {activeTask?.branch_name && (
          <div className="ml-auto pr-4">
            {activeTask.ejected ? (
              <Button
                size="sm"
                onClick={() => setInjectDialogOpen(true)}
                disabled={isAnyStageRunning}
              >
                <svg className="w-4 h-4 mr-1.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M19 14l-7 7m0 0l-7-7m7 7V3" />
                </svg>
                Inject
              </Button>
            ) : (
              <span title={!activeTask.worktree_path ? "Run a pipeline stage first to create the worktree" : undefined}>
                <Button
                  size="sm"
                  onClick={handleEjectClick}
                  disabled={isAnyStageRunning || !activeTask.worktree_path || checkingChanges}
                >
                  {checkingChanges ? (
                    <Loader2 className="w-4 h-4 mr-1.5 animate-spin" />
                  ) : (
                    <svg className="w-4 h-4 mr-1.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M5 10l7-7m0 0l7 7m-7-7v18" />
                    </svg>
                  )}
                  Eject
                </Button>
              </span>
            )}
          </div>
        )}
      </div>

      {/* Content */}
      {activeView === "overview" ? (
        <div className="flex-1 overflow-y-auto">
          <TaskOverview />
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto">
          {viewingStage ? (
            /* key includes activeTaskId so React fully remounts StageView on
               task switch, resetting all local useState (userInput, feedback,
               commitMessage, etc.) and all child component state
               (MarkdownTextarea.isEditing, StructuredOutput.fields,
               QuestionCards.selections, StageSelectionPanel.checked).
               Do NOT simplify back to key={viewingStage.id} — that would let
               stale state from the previous task bleed into the new one. */
            <StageView key={`${activeTaskId}-${viewingStage.id}`} stage={viewingStage} taskId={activeTaskId!} />
          ) : (
            <div className="flex items-center justify-center h-full">
              <p className="text-muted-foreground">No stage selected</p>
            </div>
          )}
        </div>
      )}

      {/* Eject Confirmation Dialog */}
      <AlertDialog
        open={ejectDialogOpen}
        onOpenChange={(open) => {
          if (!open) {
            setEjectDialogOpen(false);
            setEjectError(null);
            setWorktreeHasChanges(false);
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Eject to Main Repo</AlertDialogTitle>
            <AlertDialogDescription>
              This will check out the{" "}
              <code className="px-1 py-0.5 rounded bg-muted text-xs">
                {activeTask?.branch_name}
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

          {worktreeHasChanges && !ejectError && (
            <div className="space-y-3">
              <Alert>
                <AlertDescription>
                  The worktree has uncommitted changes that need to be committed
                  before ejecting.
                </AlertDescription>
              </Alert>
              {ejectDiffStat && (
                <pre className="text-xs bg-muted p-2 rounded overflow-x-auto">
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
                {worktreeHasChanges
                  ? ejecting
                    ? "Committing & Ejecting..."
                    : "Commit & Eject"
                  : ejecting
                    ? "Ejecting..."
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
                {activeTask?.branch_name}
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
    </div>
  );
}
