import { useState, useEffect, useCallback } from "react";
import { usePersistedState } from "../../hooks/usePersistedState";
import { useProcessStore, stageKey } from "../../stores/processStore";
import { useStageExecution } from "../../hooks/useStageExecution";
import { useProcessHealthCheck } from "../../hooks/useProcessHealthCheck";
import { usePrReview } from "../../hooks/usePrReview";
import { PrReviewOutput } from "../output/PrReviewOutput";
import { LiveStreamBubble } from "./StageTimeline";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { useEditorStore } from "../../stores/editorStore";
import { useProjectStore } from "../../stores/projectStore";
import { useNavigationStore } from "../../stores/navigationStore";
import { useSettingsStore } from "../../stores/settingsStore";
import { openInExternalEditor } from "../../lib/editor";
import type { TaskStageInstance, Task } from "../../lib/types";

interface PrReviewViewProps {
  stage: TaskStageInstance;
  task: Task;
}

export function PrReviewView({ stage, task }: PrReviewViewProps) {
  const sid = stage.task_stage_id;
  const sk = stageKey(task.id, sid);
  const isRunning = useProcessStore((s) => s.stages[sk]?.isRunning ?? false);
  const pendingCommit = useProcessStore((s) => s.pendingCommit);
  const { killCurrent } = useStageExecution();
  useProcessHealthCheck(sid);
  const prReview = usePrReview(stage, task);

  const [commitMessage, setCommitMessage] = usePersistedState(`pr_commit:${sk}`);
  const [committing, setCommitting] = useState(false);
  const [commitError, setCommitError] = useState<string | null>(null);

  const prReviewCompleted = task.status === "completed";

  const worktreeRoot = task.worktree_path ?? (task.ejected ? useProjectStore.getState().activeProject?.path : undefined);

  const handleOpenFile = useCallback((relativePath: string) => {
    if (!worktreeRoot) return;
    const fullPath = `${worktreeRoot}/${relativePath}`;
    const editorCommand = useSettingsStore.getState().getEditorCommand();
    if (editorCommand) {
      openInExternalEditor(editorCommand, fullPath).catch(() => {});
    } else {
      useEditorStore.getState().setWorktreeRoot(worktreeRoot);
      useEditorStore.getState().openFile(fullPath);
      useProcessStore.getState().setActiveView("editor");
      const projectId = useProjectStore.getState().activeProject?.id;
      if (projectId) {
        useNavigationStore.getState().persistTaskViewState(projectId, task.id, { activeView: "editor" });
      }
    }
  }, [task.id, worktreeRoot]);

  // Sync editable commit message when pending commit appears
  useEffect(() => {
    if (pendingCommit?.stageId === sid) {
      setCommitMessage(pendingCommit.message);
    }
  }, [pendingCommit?.stageId, pendingCommit?.message, sid]);

  const handleCommit = async () => {
    if (!pendingCommit || pendingCommit.stageId !== sid || !pendingCommit.fixId) return;
    setCommitting(true);
    setCommitError(null);
    try {
      await prReview.commitFix(pendingCommit.fixId, commitMessage);
    } catch (e) {
      setCommitError(e instanceof Error ? e.message : String(e));
    } finally {
      setCommitting(false);
    }
  };

  const handleSkipCommit = async () => {
    await prReview.skipFixCommit();
  };

  const noPrUrl = !task.pr_url;

  return (
    <div className="p-6 max-w-4xl">
      {prReviewCompleted ? (
        <Alert className="border-emerald-200 bg-emerald-50 text-emerald-800">
          <svg className="w-4 h-4 text-emerald-600 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
            <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
          </svg>
          <AlertDescription className="text-emerald-800">
            PR Review completed. Task marked as done.
          </AlertDescription>
        </Alert>
      ) : noPrUrl ? (
        <Alert variant="destructive">
          <AlertDescription>
            No PR URL found on this task. Please create a PR first (via the PR Preparation stage).
          </AlertDescription>
        </Alert>
      ) : (
        <>
          {/* Live stream output while fixing a comment */}
          {isRunning && prReview.fixingId && (
            <div className="mb-4">
              <LiveStreamBubble
                stageKey={sk}
                label="Fixing review comment..."
                onStop={() => killCurrent(task.id, sid)}
              />
            </div>
          )}

          <PrReviewOutput
            fixes={prReview.fixes}
            replies={prReview.replies}
            fixingId={prReview.fixingId}
            consideringId={prReview.consideringId}
            considerations={prReview.considerations}
            resolvingId={prReview.resolvingId}
            resolvedIds={prReview.resolvedIds}
            pushing={prReview.pushing}
            pulling={prReview.pulling}
            hasBranch={!!task.branch_name}
            onFix={prReview.fixComment}
            onConsider={prReview.considerComment}
            onResolve={prReview.resolveComment}
            onUnresolve={prReview.unresolveComment}
            onReply={prReview.replyToComment}
            onPush={prReview.pushBranch}
            onPull={prReview.pullBranch}
            onRefresh={prReview.fetchReviews}
            onOpenFile={handleOpenFile}
            loading={prReview.loading}
            isCompleted={false}
            error={prReview.error}
            stageKey={sk}
            summary={prReview.summary}
            summaryLoading={prReview.summaryLoading}
          />

          {/* Commit dialog for individual fixes */}
          {pendingCommit?.stageId === sid && pendingCommit.fixId && (
            <div className="mt-4 p-4 bg-muted/50 border border-border rounded-lg">
              <div className="flex items-center gap-2 mb-3">
                <svg className="w-4 h-4 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7H5a2 2 0 00-2 2v9a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-3m-1 4l-3 3m0 0l-3-3m3 3V4" />
                </svg>
                <span className="text-sm font-medium text-foreground">
                  Commit Fix
                </span>
              </div>

              {pendingCommit.diffStat && (
                <pre className="text-xs text-muted-foreground bg-zinc-50 dark:bg-zinc-900 border border-border rounded p-2 mb-3 overflow-x-auto">
                  {pendingCommit.diffStat}
                </pre>
              )}

              <Textarea
                value={commitMessage}
                onChange={(e) => setCommitMessage(e.target.value)}
                rows={3}
                className="font-mono mb-3 resize-none"
              />

              {commitError && (
                <Alert variant="destructive" className="mb-3">
                  <AlertDescription>{commitError}</AlertDescription>
                </Alert>
              )}

              <div className="flex gap-2">
                <Button
                  onClick={handleCommit}
                  disabled={committing || !commitMessage.trim()}
                  size="sm"
                >
                  {committing ? "Committing..." : "Commit"}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleSkipCommit}
                  disabled={committing}
                >
                  Skip
                </Button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
