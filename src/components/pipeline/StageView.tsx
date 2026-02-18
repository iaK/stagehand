import { useState, useMemo, useEffect } from "react";
import { useProjectStore } from "../../stores/projectStore";
import { useTaskStore } from "../../stores/taskStore";
import { useProcessStore, DEFAULT_STAGE_STATE, stageKey } from "../../stores/processStore";
import { useStageExecution, isCommitEligibleStage, generatePendingCommit } from "../../hooks/useStageExecution";
import { MarkdownTextarea } from "../ui/MarkdownTextarea";
import { useProcessHealthCheck } from "../../hooks/useProcessHealthCheck";
import { StageOutput } from "./StageOutput";
import {
  StageTimeline,
  UserBubble,
  CollapsibleInputBubble,
  LiveStreamBubble,
  ThinkingBubble,
} from "./StageTimeline";
import { gitAdd, gitCommit } from "../../lib/git";
import { getTaskWorkingDir } from "../../lib/worktree";
import { usePrReview } from "../../hooks/usePrReview";
import { PrReviewOutput } from "../output/PrReviewOutput";
import { MergeStageView } from "./MergeStageView";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from "@/components/ui/collapsible";
import { sendNotification } from "../../lib/notifications";
import { Loader2 } from "lucide-react";
import type { StageTemplate } from "../../lib/types";

interface StageViewProps {
  stage: StageTemplate;
}

export function StageView({ stage }: StageViewProps) {
  const activeProject = useProjectStore((s) => s.activeProject);
  const activeTask = useTaskStore((s) => s.activeTask);
  const executions = useTaskStore((s) => s.executions);
  const stageTemplates = useTaskStore((s) => s.stageTemplates);
  const setTaskStages = useTaskStore((s) => s.setTaskStages);
  const sk = activeTask ? stageKey(activeTask.id, stage.id) : stage.id;
  const { isRunning, streamOutput, killed: isStopping } = useProcessStore(
    (s) => s.stages[sk] ?? DEFAULT_STAGE_STATE,
  );
  const pendingCommit = useProcessStore((s) => s.pendingCommit);
  const committedHash = useProcessStore((s) => s.committedStages[stage.id]);
  const noChangesToCommit = useProcessStore((s) => s.noChangesStageId === stage.id);
  const { runStage, approveStage, redoStage, killCurrent } =
    useStageExecution();
  useProcessHealthCheck(stage.id);
  const prReview = usePrReview(stage, activeTask);
  const [userInput, setUserInput] = useState("");
  const [feedback, setFeedback] = useState("");
  const [showFeedback, setShowFeedback] = useState(false);
  const [showTimeline, setShowTimeline] = useState(false);
  const [commitMessage, setCommitMessage] = useState("");
  const [committing, setCommitting] = useState(false);
  const [commitError, setCommitError] = useState<string | null>(null);
  const [approving, setApproving] = useState(false);
  const [stageError, setStageError] = useState<string | null>(null);

  // Sync editable commit message when pending commit appears for this stage
  useEffect(() => {
    if (pendingCommit?.stageId === stage.id) {
      setCommitMessage(pendingCommit.message);
    }
  }, [pendingCommit?.stageId, pendingCommit?.message, stage.id]);

  const handleCommit = async () => {
    if (!activeProject || !activeTask || !pendingCommit || pendingCommit.stageId !== stage.id) return;
    setCommitting(true);
    setCommitError(null);
    try {
      if (pendingCommit.fixId) {
        // PR Review fix commit — don't advance
        await prReview.commitFix(pendingCommit.fixId, commitMessage);
      } else {
        // Standard commit — commit then approve (which advances)
        const workDir = getTaskWorkingDir(activeTask, activeProject.path);
        await gitAdd(workDir);
        const result = await gitCommit(workDir, commitMessage);
        const hashMatch = result.match(/\[[\w/.-]+\s+([a-f0-9]+)\]/);
        const shortHash = hashMatch?.[1] ?? result.slice(0, 7);
        useProcessStore.getState().setCommitted(stage.id, shortHash);
        useProcessStore.getState().clearPendingCommit();
        sendNotification("Changes committed", shortHash, "success", { projectId: activeProject.id, taskId: activeTask.id });
        await approveStage(activeTask, stage);
      }
    } catch (e) {
      setCommitError(e instanceof Error ? e.message : String(e));
    } finally {
      setCommitting(false);
    }
  };

  const handleSkipCommit = async () => {
    if (!activeProject || !activeTask) return;
    if (pendingCommit?.fixId) {
      // PR Review fix — skip commit but keep changes
      await prReview.skipFixCommit(pendingCommit.fixId);
    }
  };

  const stageExecs = useMemo(
    () =>
      executions
        .filter((e) => e.stage_template_id === stage.id)
        .sort((a, b) => a.attempt_number - b.attempt_number),
    [executions, stage.id],
  );

  const latestExecution = useMemo(
    () => (stageExecs.length > 0 ? stageExecs[stageExecs.length - 1] : null),
    [stageExecs],
  );

  const stageStatus = latestExecution?.status ?? "pending";
  const isCurrentStage = activeTask?.current_stage_id === stage.id;
  const isApproved = stageStatus === "approved";
  const needsUserInput =
    stage.input_source === "user" || stage.input_source === "both";
  const isCommitEligible = isCommitEligibleStage(stage);

  // Re-generate pending commit on mount/navigation if the stage is awaiting_user
  // but no commit dialog is present (e.g. after app restart where in-memory state was lost)
  const commitMessageLoading = useProcessStore((s) => s.commitMessageLoadingStageId === stage.id);
  useEffect(() => {
    if (
      isCommitEligible &&
      isCurrentStage &&
      stageStatus === "awaiting_user" &&
      !isRunning &&
      !pendingCommit?.stageId &&
      !noChangesToCommit &&
      !commitMessageLoading &&
      !committedHash &&
      activeTask &&
      activeProject
    ) {
      generatePendingCommit(activeTask, stage, activeProject.path, activeProject.id).catch(() => {});
    }
  }, [isCommitEligible, isCurrentStage, stageStatus, isRunning, pendingCommit?.stageId, noChangesToCommit, commitMessageLoading, committedHash, activeTask?.id, activeProject?.id]);

  // Pre-fill research input with task description (e.g. from Linear import)
  useEffect(() => {
    if (activeTask?.description && needsUserInput && !latestExecution) {
      setUserInput(activeTask.description);
    }
  }, [activeTask?.id]);

  // Past completed rounds (everything except the latest)
  const pastExecs = useMemo(
    () => (stageExecs.length > 1 ? stageExecs.slice(0, -1) : []),
    [stageExecs],
  );

  const handleRun = async () => {
    if (!activeTask) return;
    setStageError(null);
    try {
      await runStage(activeTask, stage, userInput || undefined);
    } catch (err) {
      console.error("Failed to run stage:", err);
      setStageError(err instanceof Error ? err.message : String(err));
    }
  };

  const handleApprove = async (decision?: string) => {
    if (!activeProject || !activeTask) return;
    setApproving(true);
    setStageError(null);
    try {
      await approveStage(activeTask, stage, decision);
      // Skip notification for commit-eligible stages — handleCommit/handleSkipCommit
      // already send their own notification before calling approveStage directly
      if (!isCommitEligible) {
        sendNotification("Stage approved", stage.name, "success", { projectId: activeProject.id, taskId: activeTask.id });
      }
    } catch (err) {
      console.error("Failed to approve stage:", err);
      setStageError(err instanceof Error ? err.message : String(err));
      setApproving(false);
    }
  };

  const handleRedo = async () => {
    if (!activeTask) return;
    useProcessStore.getState().clearPendingCommit();
    useProcessStore.getState().setNoChangesToCommit(null);
    setShowFeedback(false);
    setStageError(null);
    try {
      await redoStage(activeTask, stage, feedback || undefined);
      setFeedback("");
    } catch (err) {
      console.error("Failed to redo stage:", err);
      setStageError(err instanceof Error ? err.message : String(err));
    }
  };

  const handleSubmitAnswers = async (answers: string) => {
    if (!activeTask) return;
    setStageError(null);
    await redoStage(activeTask, stage, answers);
  };

  const handleApproveWithStages = async (selectedStageIds: string[]) => {
    if (!activeTask || !activeProject) return;
    setApproving(true);
    try {
      // Auto-include PR Review whenever a creates_pr stage is selected
      let ids = [...selectedStageIds];
      const hasPrCreator = stageTemplates.some(
        (t) => ids.includes(t.id) && t.creates_pr,
      );
      if (hasPrCreator) {
        const prReviewTemplate = stageTemplates.find((t) => t.output_format === "pr_review");
        if (prReviewTemplate && !ids.includes(prReviewTemplate.id)) {
          ids.push(prReviewTemplate.id);
        }
      }

      // Note: Merge stage inclusion is handled by ResearchOutput's handleApprove
      // which includes terminal stages based on the project's completion strategy.

      // Build stages with sort orders from the templates
      const stages = ids
        .map((id) => {
          const t = stageTemplates.find((s) => s.id === id);
          return t ? { stageTemplateId: id, sortOrder: t.sort_order } : null;
        })
        .filter((s): s is { stageTemplateId: string; sortOrder: number } => s !== null);

      // Persist selected stages before approving
      await setTaskStages(activeProject.id, activeTask.id, stages);
      await approveStage(activeTask, stage);
    } catch (err) {
      console.error("Failed to approve with stages:", err);
      setStageError(err instanceof Error ? err.message : String(err));
      setApproving(false);
    }
  };

  if (!activeProject || !activeTask) return null;

  // Merge: custom rendering
  if (stage.output_format === "merge") {
    return <MergeStageView stage={stage} />;
  }

  // PR Review: custom rendering — no standard stage flow
  if (stage.output_format === "pr_review") {
    const noPrUrl = !activeTask.pr_url;
    const prReviewCompleted = isApproved || activeTask.status === "completed";
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
                  streamLines={streamOutput}
                  label="Fixing review comment..."
                  onStop={() => killCurrent(activeTask!.id, stage.id)}
                  isStopping={isStopping}
                />
              </div>
            )}

            <PrReviewOutput
              fixes={prReview.fixes}
              fixingId={prReview.fixingId}
              onFix={prReview.fixComment}
              onSkip={prReview.skipFix}
              onMarkDone={prReview.markDone}
              onRefresh={prReview.fetchReviews}
              loading={prReview.loading}
              isCompleted={false}
              error={prReview.error}
              streamOutput={streamOutput}
            />

            {/* Commit dialog for individual fixes */}
            {pendingCommit?.stageId === stage.id && pendingCommit.fixId && (
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

  const showInitialForm =
    isCurrentStage && !isRunning && (stageStatus === "pending" || !latestExecution);

  return (
    <div className="p-6 max-w-4xl">
      {latestExecution && latestExecution.attempt_number > 1 && (
        <p className="text-xs text-muted-foreground mb-4">
          Attempt #{latestExecution.attempt_number}
        </p>
      )}

      {/* Future stage -- not current, nothing has run */}
      {!isCurrentStage && !latestExecution && (
        <div className="mb-6 py-6 text-center text-muted-foreground">
          <svg className="w-8 h-8 mx-auto mb-2 text-zinc-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <p className="text-sm">Waiting for earlier stages to complete</p>
        </div>
      )}

      {/* Initial form -- only when nothing has run yet */}
      {showInitialForm && (
        <div className="mb-6">
          {needsUserInput && (
            <div className="mb-4">
              <Label>
                {stage.input_source === "both"
                  ? "Additional context or feedback"
                  : "Describe what you need"}
              </Label>
              <MarkdownTextarea
                value={userInput}
                onChange={setUserInput}
                rows={4}
                placeholder="Enter additional context..."
                className="mt-2"
              />
            </div>
          )}
          {stageError && (
            <Alert variant="destructive" className="mb-4">
              <AlertDescription>{stageError}</AlertDescription>
            </Alert>
          )}
          <Button onClick={handleRun} disabled={isRunning}>
            Run Stage
          </Button>
        </div>
      )}

      {/* APPROVED: collapsible timeline + final result */}
      {latestExecution && isApproved && (
        <div className="mb-6">
          {stageExecs.length > 0 && (
            <Collapsible open={showTimeline} onOpenChange={setShowTimeline} className="mb-4">
              <CollapsibleTrigger className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors">
                <svg
                  className={`w-3 h-3 transition-transform ${showTimeline ? "rotate-90" : ""}`}
                  fill="currentColor"
                  viewBox="0 0 20 20"
                >
                  <path fillRule="evenodd" d="M7.293 14.707a1 1 0 010-1.414L10.586 10 7.293 6.707a1 1 0 011.414-1.414l4 4a1 1 0 010 1.414l-4 4a1 1 0 01-1.414 0z" clipRule="evenodd" />
                </svg>
                {showTimeline ? "Hide" : "Show"} process ({stageExecs.length} {stageExecs.length === 1 ? "round" : "rounds"})
              </CollapsibleTrigger>
              <CollapsibleContent>
                <div className="mt-3">
                  <StageTimeline executions={stageExecs} stage={stage} />
                </div>
              </CollapsibleContent>
            </Collapsible>
          )}

          {(stage.output_format === "research" || stage.output_format === "findings") && (
            <Alert className="mb-4 border-emerald-200 bg-emerald-50 text-emerald-800">
              <svg className="w-4 h-4 text-emerald-600 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
              </svg>
              <AlertDescription className="text-emerald-800">
                {stage.output_format === "research"
                  ? "Research Complete"
                  : (() => {
                      // Detect Phase 1 (findings JSON) vs Phase 2 (text) from content
                      const out = latestExecution.parsed_output ?? latestExecution.raw_output ?? "";
                      try {
                        const p = JSON.parse(out);
                        if (p.findings && Array.isArray(p.findings)) return "Review Complete";
                      } catch { /* not JSON */ }
                      return latestExecution.attempt_number > 1 ? "Findings Applied" : "Review Complete";
                    })()}
              </AlertDescription>
            </Alert>
          )}

          <StageOutput
            execution={latestExecution}
            stage={stage}
            onApprove={handleApprove}
            onSubmitAnswers={handleSubmitAnswers}
            isApproved={true}
          />

          {latestExecution.thinking_output && (
            <div className="mt-3">
              <ThinkingBubble
                text={latestExecution.thinking_output}
                label="Final round thinking"
              />
            </div>
          )}
        </div>
      )}

      {/* COMMITTED BADGE */}
      {committedHash && isApproved && (
        <Alert className="mb-6 border-emerald-200 bg-emerald-50 text-emerald-700">
          <svg className="w-4 h-4 text-emerald-600" fill="currentColor" viewBox="0 0 20 20">
            <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
          </svg>
          <AlertDescription className="text-emerald-700">
            Committed: <code className="font-mono">{committedHash}</code>
          </AlertDescription>
        </Alert>
      )}

      {/* RUNNING / AWAITING: live timeline */}
      {(latestExecution || isRunning) && !isApproved && !showInitialForm && (
        <div className="relative mb-6">
          {/* Vertical line for the whole timeline */}
          <div className="absolute left-3 top-3 bottom-3 w-px bg-border" />

          {/* Past completed rounds */}
          {pastExecs.length > 0 && (
            <StageTimeline executions={pastExecs} stage={stage} />
          )}

          {/* Current round: user input */}
          {latestExecution?.user_input && (
            stage.input_source === "previous_stage" ? (
              <CollapsibleInputBubble
                text={latestExecution.user_input}
                label="Input from previous stage"
              />
            ) : (
              <UserBubble
                text={latestExecution.user_input}
                label={
                  latestExecution.attempt_number === 1
                    ? "Your input"
                    : "Your answers"
                }
              />
            )
          )}

          {/* Current round: RUNNING -- live stream */}
          {(stageStatus === "running" || isRunning) && (
            <LiveStreamBubble
              streamLines={streamOutput}
              label={`${stage.name} working...`}
              onStop={() => killCurrent(activeTask!.id, stage.id)}
              isStopping={isStopping}
            />
          )}

          {/* Current round: DONE -- interactive output */}
          {stageStatus === "awaiting_user" && !isRunning && latestExecution && (
            <div className="pl-9">
              {latestExecution.thinking_output && (
                <div className="mb-3 -ml-9">
                  <ThinkingBubble
                    text={latestExecution.thinking_output}
                    label={`Thinking #${latestExecution.attempt_number}`}
                  />
                </div>
              )}
              <StageOutput
                execution={latestExecution}
                stage={stage}
                onApprove={handleApprove}
                onApproveWithStages={stage.triggers_stage_selection ? handleApproveWithStages : undefined}
                onSubmitAnswers={handleSubmitAnswers}
                isApproved={false}
                stageTemplates={stage.triggers_stage_selection ? stageTemplates : undefined}
                approving={approving}
                isCommitEligible={isCommitEligible}
              />

              {/* Inline commit dialog for commit-eligible stages */}
              {isCommitEligible && isCurrentStage && (
                pendingCommit?.stageId === stage.id ? (
                  <div className="mt-4 p-4 bg-muted/50 border border-border rounded-lg">
                    <div className="flex items-center gap-2 mb-3">
                      <svg className="w-4 h-4 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7H5a2 2 0 00-2 2v9a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-3m-1 4l-3 3m0 0l-3-3m3 3V4" />
                      </svg>
                      <span className="text-sm font-medium text-foreground">
                        Commit Changes
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

                    <Button
                      onClick={handleCommit}
                      disabled={committing || !commitMessage.trim()}
                      size="sm"
                      variant="success"
                    >
                      {committing && <Loader2 className="w-4 h-4 animate-spin" />}
                      {committing ? "Committing..." : "Commit & Continue"}
                    </Button>
                  </div>
                ) : noChangesToCommit ? (
                  <Button
                    variant="success"
                    onClick={() => {
                      useProcessStore.getState().setNoChangesToCommit(null);
                      handleApprove();
                    }}
                    disabled={approving}
                    className="mt-4"
                  >
                    {approving && <Loader2 className="w-4 h-4 animate-spin" />}
                    {approving ? "Approving..." : "Continue (no changes to commit)"}
                  </Button>
                ) : (
                  <div className="mt-4 flex items-center gap-2 text-sm text-muted-foreground">
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Preparing commit...
                  </div>
                )
              )}

              {stageError && (
                <Alert variant="destructive" className="mt-4">
                  <AlertDescription>{stageError}</AlertDescription>
                </Alert>
              )}

              {/* Redo actions */}
              {isCurrentStage && (
                <div className="flex items-start gap-3 mt-4">
                  {!showFeedback && (
                    <Button
                      variant="outline"
                      onClick={() => setShowFeedback(true)}
                    >
                      Redo with Feedback
                    </Button>
                  )}
                  {showFeedback && (
                    <div className="flex-1 max-w-lg">
                      <MarkdownTextarea
                        value={feedback}
                        onChange={setFeedback}
                        rows={3}
                        placeholder="What should be changed?"
                        autoFocus
                        className="mb-2"
                      />
                      <div className="flex gap-2">
                        <Button variant="warning" onClick={handleRedo}>
                          Redo
                        </Button>
                        <Button variant="ghost" onClick={() => setShowFeedback(false)}>
                          Cancel
                        </Button>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Current round: FAILED */}
          {stageStatus === "failed" && !isRunning && latestExecution && (
            <div className="pl-9">
              {latestExecution.error_message && (
                <Alert variant="destructive">
                  <AlertDescription>{latestExecution.error_message}</AlertDescription>
                </Alert>
              )}
              {stageError && (
                <Alert variant="destructive" className="mt-2">
                  <AlertDescription>{stageError}</AlertDescription>
                </Alert>
              )}
              {isCurrentStage && (
                <Button
                  variant="warning"
                  onClick={handleRun}
                  disabled={isRunning}
                  className="mt-4"
                >
                  Retry
                </Button>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
