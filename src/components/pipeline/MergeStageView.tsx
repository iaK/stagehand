import { useState, useEffect } from "react";
import { useProjectStore } from "../../stores/projectStore";
import { useTaskStore } from "../../stores/taskStore";
import { useGitHubStore } from "../../stores/githubStore";
import { performMerge } from "../../lib/merge";
import {
  gitDefaultBranch,
  gitDiffNameOnly,
  gitDiffStatBranch,
  gitFetch,
  gitHasRemote,
  gitIsMerged,
  gitWorktreeRemove,
  gitDeleteBranch,
  gitDiffStat,
  gitAdd,
  gitCommit,
} from "../../lib/git";
import { logger } from "../../lib/logger";
import { getTaskWorkingDir } from "../../lib/worktree";
import * as repo from "../../lib/repositories";
import { sendNotification } from "../../lib/notifications";
import { spawnAgent } from "../../lib/agent";
import { parseAgentStreamLine } from "../../lib/agentParsers";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle, AlertDialogDescription, AlertDialogFooter, AlertDialogCancel, AlertDialogAction } from "@/components/ui/alert-dialog";
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from "@/components/ui/collapsible";
import { Loader2 } from "lucide-react";
import { useProcessStore, stageKey } from "../../stores/processStore";
import type { MergeState } from "../../stores/processStore";
import type { StageTemplate, AgentStreamEvent } from "../../lib/types";

/**
 * MergeStageView intentionally bypasses the standard useStageExecution hook and
 * manages its own execution lifecycle (create, approve/fail, task completion,
 * worktree cleanup). This keeps the merge flow simple and self-contained.
 * If changes are made to the standard stage execution flow (notifications,
 * logging, analytics), check whether they should also apply here.
 */
interface MergeStageViewProps {
  stage: StageTemplate;
}

export function MergeStageView({ stage }: MergeStageViewProps) {
  const activeProject = useProjectStore((s) => s.activeProject);
  const activeTask = useTaskStore((s) => s.activeTask);
  const executions = useTaskStore((s) => s.executions);
  const updateTask = useTaskStore((s) => s.updateTask);
  const loadExecutions = useTaskStore((s) => s.loadExecutions);

  const sk = activeTask ? stageKey(activeTask.id, stage.id) : "";
  const mergeStage = useProcessStore((s) => s.mergeStages[sk]);
  const updateMergeState = useProcessStore((s) => s.updateMergeState);

  // Store-persisted state (survives navigation)
  const mergeState: MergeState = mergeStage?.mergeState ?? "loading";
  const error = mergeStage?.error ?? null;
  const fixRunning = mergeStage?.fixRunning ?? false;
  const fixOutput = mergeStage?.fixOutput ?? "";
  const fixCommitMessage = mergeStage?.fixCommitMessage ?? "";
  const fixCommitDiffStat = mergeStage?.fixCommitDiffStat ?? "";

  const setMergeState = (v: MergeState) => updateMergeState(sk, { mergeState: v });
  const setError = (v: string | null) => updateMergeState(sk, { error: v });
  const setFixRunning = (v: boolean) => updateMergeState(sk, { fixRunning: v });
  const setFixOutput = (v: string | ((prev: string) => string)) => {
    if (typeof v === "function") {
      const current = useProcessStore.getState().mergeStages[sk]?.fixOutput ?? "";
      updateMergeState(sk, { fixOutput: v(current) });
    } else {
      updateMergeState(sk, { fixOutput: v });
    }
  };
  const setFixCommitMessage = (v: string) => updateMergeState(sk, { fixCommitMessage: v });
  const setFixCommitDiffStat = (v: string) => updateMergeState(sk, { fixCommitDiffStat: v });

  // Local-only state (OK to reset on navigation)
  const [targetBranch, setTargetBranch] = useState<string>("main");
  const [hasRemote, setHasRemote] = useState<boolean>(true);
  const [changedFiles, setChangedFiles] = useState<string[]>([]);
  const [diffStat, setDiffStat] = useState<string>("");
  const [showSkipConfirm, setShowSkipConfirm] = useState(false);
  const [fixCommitting, setFixCommitting] = useState(false);
  const [fixCommitError, setFixCommitError] = useState<string | null>(null);

  // Check if this stage already has an approved execution
  const latestExecution = executions
    .filter((e) => e.stage_template_id === stage.id && e.task_id === activeTask?.id)
    .sort((a, b) => b.attempt_number - a.attempt_number)[0] ?? null;

  const isApproved = latestExecution?.status === "approved";

  // Load merge preview data on mount. If the store already has a persisted
  // mergeState (e.g. "error", "fix_commit") we keep it and only refresh the
  // git metadata (targetBranch, changedFiles, diffStat). On first mount
  // (mergeState === "loading") we transition to "preview" once data is ready.
  useEffect(() => {
    if (!activeProject || !activeTask?.branch_name) {
      if (mergeState === "loading") setMergeState("preview");
      return;
    }

    const branchName = activeTask.branch_name;
    let cancelled = false;
    (async () => {
      try {
        // If the DB says this stage was approved, trust it — the branch may
        // have been deleted after a successful merge, so gitIsMerged would
        // return false even though the merge actually happened.
        if (isApproved) {
          if (!cancelled) setMergeState("completed");
          return;
        }

        // If the in-memory store thinks merge succeeded but we're re-mounting,
        // verify against git before trusting the cached state.
        if (mergeState === "completed" || mergeState === "success") {
          const defaultBr = useGitHubStore.getState().defaultBranch
            ?? await gitDefaultBranch(activeProject.path)
            ?? "main";
          const actuallyMerged = await gitIsMerged(activeProject.path, branchName, defaultBr).catch(() => false);
          if (!cancelled && !actuallyMerged) {
            setMergeState("preview");
          }
          return;
        }

        const workDir = getTaskWorkingDir(activeTask, activeProject.path);
        const remote = await gitHasRemote(activeProject.path);
        if (!cancelled) setHasRemote(remote);

        const defaultBr = useGitHubStore.getState().defaultBranch
          ?? await gitDefaultBranch(activeProject.path)
          ?? "main";
        setTargetBranch(defaultBr);

        // Fetch remote so diff is accurate
        if (remote) {
          await gitFetch(activeProject.path, defaultBr).catch(() => {});
        }

        const diffBase = remote ? `origin/${defaultBr}` : defaultBr;
        const files = await gitDiffNameOnly(workDir, diffBase).catch(() => [] as string[]);
        const stat = await gitDiffStatBranch(workDir, diffBase).catch(() => "");

        if (!cancelled) {
          setChangedFiles(files);
          setDiffStat(stat);
          // Only transition to preview on first load; keep persisted state otherwise
          if (mergeState === "loading") setMergeState("preview");
        }
      } catch {
        if (!cancelled && mergeState === "loading") setMergeState("preview");
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed by ID to avoid re-running on object identity changes
  }, [activeProject?.id, activeTask?.id, isApproved]);

  const handleMerge = async () => {
    if (!activeProject || !activeTask?.branch_name) return;
    setMergeState("merging");
    setError(null);

    // Hoist executionId so the catch block can mark it as failed
    const prevAttempts = executions.filter((e) => e.stage_template_id === stage.id);
    const attemptNumber = prevAttempts.length + 1;
    const executionId = crypto.randomUUID();

    try {
      // Create an execution record for this stage
      await repo.createStageExecution(activeProject.id, {
        id: executionId,
        task_id: activeTask.id,
        stage_template_id: stage.id,
        attempt_number: attemptNumber,
        status: "running",
        input_prompt: "",
        user_input: null,
        raw_output: null,
        parsed_output: null,
        user_decision: null,
        session_id: null,
        error_message: null,
        thinking_output: null,
        stage_result: null,
        stage_summary: null,
        input_tokens: null,
        output_tokens: null,
        cache_creation_input_tokens: null,
        cache_read_input_tokens: null,
        total_cost_usd: null,
        duration_ms: null,
        num_turns: null,
        started_at: new Date().toISOString(),
      });

      await performMerge({
        projectPath: activeProject.path,
        branchName: activeTask.branch_name,
        targetBranch,
      });

      // Mark execution as approved
      await repo.updateStageExecution(activeProject.id, executionId, {
        status: "approved",
        parsed_output: `Merged ${activeTask.branch_name} into ${targetBranch}`,
        stage_result: `Merged ${activeTask.branch_name} into ${targetBranch}`,
        stage_summary: `Branch merged into ${targetBranch}`,
        completed_at: new Date().toISOString(),
      });

      sendNotification("Branch merged", `${activeTask.branch_name} merged into ${targetBranch}`, "success", {
        projectId: activeProject.id,
        taskId: activeTask.id,
      });

      // Mark task as completed
      await updateTask(activeProject.id, activeTask.id, {
        status: "completed",
      });

      // Clean up worktree first (must happen before branch deletion)
      if (activeTask.worktree_path) {
        try {
          await gitWorktreeRemove(activeProject.path, activeTask.worktree_path);
        } catch {
          // Non-critical
        }
      }
      // Only delete the branch after verifying it was fully merged
      if (activeTask.branch_name) {
        const merged = await gitIsMerged(activeProject.path, activeTask.branch_name, targetBranch);
        if (merged) {
          try {
            await gitDeleteBranch(activeProject.path, activeTask.branch_name);
          } catch {
            // Non-critical
          }
        }
      }

      await loadExecutions(activeProject.id, activeTask.id);
      setMergeState("success");
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      // Mark execution as failed so it's not left orphaned as 'running'
      await repo.updateStageExecution(activeProject.id, executionId, {
        status: "failed",
        error_message: msg,
        completed_at: new Date().toISOString(),
      }).catch((err) => logger.error("Failed to update stage execution status after merge error", err));
      await loadExecutions(activeProject.id, activeTask.id).catch((err) => logger.error("Failed to reload executions after merge error", err));
      setError(msg);
      setMergeState("error");
    }
  };

  const handleAskAgentToFix = async () => {
    if (!activeProject || !activeTask?.branch_name || !error) return;
    setFixRunning(true);
    setFixOutput("");
    const workDir = getTaskWorkingDir(activeTask, activeProject.path);

    // Resolve effective agent: per-stage override → project default → "claude"
    const agentSetting = await repo.getProjectSetting(activeProject.id, "default_agent");
    const effectiveAgent = stage.agent ?? agentSetting ?? "claude";

    const prompt = `A git merge operation failed with the following error. Fix whatever is preventing the merge from succeeding.

Task: ${activeTask.title}
Merging: "${activeTask.branch_name}" into "${targetBranch}"

${changedFiles.length > 0 ? `Changed files:\n${changedFiles.join("\n")}\n\n` : ""}${diffStat ? `Diff stat:\n${diffStat}\n\n` : ""}Git error:
${error}

Investigate and fix the issue (e.g. resolve merge conflicts, fix compatibility problems). Do NOT run git merge, git push, or any merge/push commands — the user will retry the merge after reviewing your fixes.`;

    try {
      await new Promise<void>((resolve) => {
        spawnAgent(
          {
            prompt,
            agent: effectiveAgent,
            workingDirectory: workDir,
            noSessionPersistence: true,
            outputFormat: "stream-json",
          },
          (event: AgentStreamEvent) => {
            switch (event.type) {
              case "stdout_line": {
                const parsed = parseAgentStreamLine(event.line);
                if (parsed) {
                  if (parsed.text) setFixOutput((prev) => prev + parsed.text);
                } else {
                  setFixOutput((prev) => prev + event.line + "\n");
                }
                break;
              }
              case "stderr_line":
                setFixOutput((prev) => prev + `[stderr] ${event.line}\n`);
                break;
              case "completed":
              case "error":
                resolve();
                break;
            }
          },
        ).catch(() => resolve());
      });
    } finally {
      setFixRunning(false);
      setError(null);
      // Always show the commit view after the agent runs so the user can
      // commit any changes before retrying the merge. If there's nothing
      // to commit they can skip with the "Skip commit" button.
      setFixCommitMessage("fix: resolve merge conflicts");
      setFixCommitError(null);
      try {
        const workDir = getTaskWorkingDir(activeTask!, activeProject!.path);
        const stat = await gitDiffStat(workDir).catch(() => "");
        setFixCommitDiffStat(stat);
      } catch {
        setFixCommitDiffStat("");
      }
      setMergeState("fix_commit");
    }
  };

  const handleFixCommit = async () => {
    if (!activeProject || !activeTask) return;
    setFixCommitting(true);
    setFixCommitError(null);
    try {
      const workDir = getTaskWorkingDir(activeTask, activeProject.path);
      await gitAdd(workDir);
      await gitCommit(workDir, fixCommitMessage);
      setMergeState("preview");
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      // "nothing to commit" is not an error — just proceed to preview
      if (/nothing to commit|nothing added to commit|no changes added/i.test(msg)) {
        setMergeState("preview");
      } else {
        setFixCommitError(msg);
      }
    } finally {
      setFixCommitting(false);
    }
  };

  const handleSkip = async () => {
    if (!activeProject || !activeTask) return;

    await updateTask(activeProject.id, activeTask.id, {
      status: "completed",
    });

    sendNotification("Merge skipped", "Task completed without merging");

    if (activeTask.worktree_path) {
      try {
        await gitWorktreeRemove(activeProject.path, activeTask.worktree_path);
      } catch {
        // Non-critical
      }
    }

    await loadExecutions(activeProject.id, activeTask.id);
    setMergeState("success");
  };

  if (!activeProject || !activeTask) return null;

  if (mergeState === "completed" || mergeState === "success") {
    return (
      <div className="p-6 max-w-4xl">
        <Alert className="border-emerald-200 dark:border-emerald-500/20 bg-emerald-50 dark:bg-emerald-500/10 text-emerald-800 dark:text-emerald-300">
          <svg className="w-4 h-4 text-emerald-600 dark:text-emerald-400 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
            <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
          </svg>
          <AlertDescription className="text-emerald-800 dark:text-emerald-300">
            Branch merged successfully. Task complete.
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  if (mergeState === "loading") {
    return (
      <div className="p-6 max-w-4xl">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="w-4 h-4 animate-spin" />
          Loading merge preview...
        </div>
      </div>
    );
  }

  if (mergeState === "fix_commit") {
    return (
      <div className="p-6 max-w-4xl">
        <div className="p-4 bg-muted/50 border border-border rounded-lg">
          <div className="flex items-center gap-2 mb-3">
            <svg className="w-4 h-4 text-blue-600 dark:text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7H5a2 2 0 00-2 2v9a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-3m-1 4l-3 3m0 0l-3-3m3 3V4" />
            </svg>
            <span className="text-sm font-medium text-foreground">Commit Agent Changes</span>
          </div>

          {fixCommitDiffStat ? (
            <pre className="text-xs text-muted-foreground bg-zinc-50 dark:bg-zinc-900 border border-border rounded p-2 mb-3 overflow-x-auto">
              {fixCommitDiffStat}
            </pre>
          ) : (
            <p className="text-xs text-muted-foreground mb-3">
              No file changes detected. Skip if the agent didn't modify anything, or commit if you made manual changes.
            </p>
          )}

          <Textarea
            value={fixCommitMessage}
            onChange={(e) => setFixCommitMessage(e.target.value)}
            rows={2}
            className="font-mono mb-3 resize-none"
          />

          {fixCommitError && (
            <Alert variant="destructive" className="mb-3">
              <AlertDescription>{fixCommitError}</AlertDescription>
            </Alert>
          )}

          <div className="flex items-center gap-2">
            <Button
              onClick={handleFixCommit}
              disabled={fixCommitting || !fixCommitMessage.trim()}
              size="sm"
              variant="success"
            >
              {fixCommitting && <Loader2 className="w-4 h-4 animate-spin" />}
              {fixCommitting ? "Committing..." : "Commit & Retry Merge"}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setMergeState("preview")}
              disabled={fixCommitting}
            >
              Skip commit
            </Button>
          </div>
        </div>

        {fixOutput && (
          <Collapsible className="mt-3">
            <CollapsibleTrigger className="text-xs text-muted-foreground hover:text-foreground transition-colors cursor-pointer flex items-center gap-1">
              <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M7.293 14.707a1 1 0 010-1.414L10.586 10 7.293 6.707a1 1 0 011.414-1.414l4 4a1 1 0 010 1.414l-4 4a1 1 0 01-1.414 0z" clipRule="evenodd" />
              </svg>
              Show agent output
            </CollapsibleTrigger>
            <CollapsibleContent>
              <pre className="mt-1 text-xs text-muted-foreground bg-muted p-2 rounded overflow-x-auto whitespace-pre-wrap max-h-64 overflow-y-auto">
                {fixOutput}
              </pre>
            </CollapsibleContent>
          </Collapsible>
        )}
      </div>
    );
  }

  if (!activeTask.branch_name) {
    return (
      <div className="p-6 max-w-4xl">
        <Alert variant="destructive">
          <AlertDescription>
            No branch associated with this task. Cannot merge.
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  return (
    <div className="p-6 max-w-4xl">
      <div className="p-4 bg-muted/50 border border-border rounded-lg">
        <div className="flex items-center gap-2 mb-3">
          <svg className="w-4 h-4 text-blue-600 dark:text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4" />
          </svg>
          <span className="text-sm font-medium text-foreground">
            Merge Branch
          </span>
        </div>

        <p className="text-sm text-muted-foreground mb-3">
          Merge <code className="font-mono text-foreground bg-zinc-100 dark:bg-zinc-800 px-1 rounded">{activeTask.branch_name}</code> into <code className="font-mono text-foreground bg-zinc-100 dark:bg-zinc-800 px-1 rounded">{targetBranch}</code>
        </p>

        {changedFiles.length > 0 && (
          <div className="mb-3">
            <p className="text-xs font-medium text-muted-foreground mb-1">
              {changedFiles.length} file{changedFiles.length !== 1 ? "s" : ""} changed
            </p>
            <div className="max-h-32 overflow-y-auto text-xs font-mono text-muted-foreground bg-zinc-50 dark:bg-zinc-900 border border-border rounded p-2">
              {changedFiles.map((f) => (
                <div key={f}>{f}</div>
              ))}
            </div>
          </div>
        )}

        {diffStat && (
          <pre className="text-xs text-muted-foreground bg-zinc-50 dark:bg-zinc-900 border border-border rounded p-2 mb-3 overflow-x-auto">
            {diffStat}
          </pre>
        )}

        {error && (
          <div className="mb-3 space-y-2">
            <Alert variant="destructive">
              <AlertDescription>
                {/conflict|CONFLICT|merge conflict/i.test(error) ? (
                  <div className="space-y-2">
                    <p className="font-medium">Merge conflicts detected</p>
                    <p className="text-sm">
                      Resolve conflicts locally in your branch, commit the resolution, then retry.
                    </p>
                  </div>
                ) : (
                  <p>{error}</p>
                )}
              </AlertDescription>
            </Alert>
            {/conflict|CONFLICT|merge conflict/i.test(error) && (
              <Collapsible>
                <CollapsibleTrigger className="text-xs text-muted-foreground hover:text-foreground transition-colors cursor-pointer flex items-center gap-1">
                  <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M7.293 14.707a1 1 0 010-1.414L10.586 10 7.293 6.707a1 1 0 011.414-1.414l4 4a1 1 0 010 1.414l-4 4a1 1 0 01-1.414 0z" clipRule="evenodd" />
                  </svg>
                  Show raw error
                </CollapsibleTrigger>
                <CollapsibleContent>
                  <pre className="mt-1 text-xs text-muted-foreground bg-muted p-2 rounded overflow-x-auto whitespace-pre-wrap">
                    {error}
                  </pre>
                </CollapsibleContent>
              </Collapsible>
            )}
            <div className="flex items-center gap-2">
              {fixRunning ? (
                <Button variant="outline" size="sm" disabled>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Agent fixing...
                </Button>
              ) : (
                <>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => { setError(null); setMergeState("preview"); }}
                  >
                    Retry
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleAskAgentToFix}
                  >
                    Ask agent to fix
                  </Button>
                </>
              )}
            </div>
            {fixRunning && fixOutput && (
              <pre className="mt-2 text-xs text-muted-foreground bg-muted p-2 rounded overflow-x-auto whitespace-pre-wrap max-h-64 overflow-y-auto">
                {fixOutput}
              </pre>
            )}
          </div>
        )}

        {!fixRunning && (
          <div className="flex gap-2">
            <Button
              onClick={handleMerge}
              disabled={mergeState === "merging"}
              size="sm"
            >
              {mergeState === "merging" && <Loader2 className="w-4 h-4 animate-spin" />}
              {mergeState === "merging" ? "Merging..." : "Merge"}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setShowSkipConfirm(true)}
              disabled={mergeState === "merging"}
            >
              Skip
            </Button>
          </div>
        )}
      </div>

      <AlertDialog open={showSkipConfirm} onOpenChange={setShowSkipConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Skip Merge</AlertDialogTitle>
            <AlertDialogDescription>
              This will mark the task as completed without merging the branch. The worktree will be removed.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={() => { setShowSkipConfirm(false); handleSkip(); }}>
              Skip
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
