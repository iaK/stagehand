import { useState, useMemo, useEffect } from "react";
import { useProjectStore } from "../../stores/projectStore";
import { useTaskStore } from "../../stores/taskStore";
import { useProcessStore, stageKey } from "../../stores/processStore";
import { useStageExecution, generatePendingCommit } from "../../hooks/useStageExecution";
import { MarkdownTextarea } from "../ui/MarkdownTextarea";
import { useProcessHealthCheck } from "../../hooks/useProcessHealthCheck";
import { formatHasOwnActionButton } from "../../lib/outputDetection";
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
import { MergeStageView } from "./MergeStageView";
import { PrReviewView } from "./PrReviewView";
import { InteractiveTerminalStageView } from "./InteractiveTerminalStageView";
import { CommitWorkflow } from "./CommitWorkflow";
import { StageInputArea } from "./StageInputArea";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from "@/components/ui/collapsible";
import { sendNotification } from "../../lib/notifications";
import { logger } from "../../lib/logger";
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
  const isRunning = useProcessStore((s) => s.stages[sk]?.isRunning ?? false);
  const pendingCommit = useProcessStore((s) => s.pendingCommit);
  const committedHash = useProcessStore((s) => s.committedStages[stage.id]);
  const noChangesToCommit = useProcessStore((s) => s.noChangesStageId === stage.id);
  const { runStage, approveStage, redoStage, killCurrent } =
    useStageExecution();
  useProcessHealthCheck(stage.id);
  const [userInput, setUserInput] = useState("");
  const [feedback, setFeedback] = useState("");
  const [showFeedback, setShowFeedback] = useState(false);
  const [showTimeline, setShowTimeline] = useState(false);
  const [commitMessage, setCommitMessage] = useState("");
  const [committing, setCommitting] = useState(false);
  const [commitError, setCommitError] = useState<string | null>(null);
  const [approving, setApproving] = useState(false);
  const [stageError, setStageError] = useState<string | null>(null);
  const [commitPrepTimedOut, setCommitPrepTimedOut] = useState(false);

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
      const workDir = getTaskWorkingDir(activeTask, activeProject.path);
      await gitAdd(workDir);
      const result = await gitCommit(workDir, commitMessage);
      const hashMatch = result.match(/\[[\w/.-]+\s+([a-f0-9]+)\]/);
      const shortHash = hashMatch?.[1] ?? result.slice(0, 7);
      useProcessStore.getState().setCommitted(stage.id, shortHash);
      useProcessStore.getState().clearPendingCommit();
      sendNotification("Changes committed", shortHash, "success", { projectId: activeProject.id, taskId: activeTask.id });
      await approveStage(activeTask, stage);
    } catch (e) {
      setCommitError(e instanceof Error ? e.message : String(e));
      // Re-check git status — if user committed externally, switch to continue button
      if (activeTask && activeProject) {
        generatePendingCommit(activeTask, stage, activeProject.path, activeProject.id).catch(() => {});
      }
    } finally {
      setCommitting(false);
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
  const needsUserInput = !!stage.requires_user_input;

  // Determine whether the output component renders its own action button.
  const outputHasOwnActionButton = useMemo(() => {
    if (!latestExecution) return false;
    const output = latestExecution.parsed_output ?? latestExecution.raw_output ?? "";
    return formatHasOwnActionButton(output, stage.output_format);
  }, [!!latestExecution, latestExecution?.parsed_output, latestExecution?.raw_output, stage.output_format]);

  // Re-generate pending commit on mount/navigation if the stage is awaiting_user
  // but no commit dialog is present (e.g. after app restart where in-memory state was lost,
  // or a stale pendingCommit from a different stage is still in the store)
  const commitMessageLoading = useProcessStore((s) => s.commitMessageLoadingStageId === stage.id);
  const hasPendingCommitForThisStage = pendingCommit?.stageId === stage.id && pendingCommit?.taskId === activeTask?.id;
  useEffect(() => {
    if (
      isCurrentStage &&
      stageStatus === "awaiting_user" &&
      !isRunning &&
      !committedHash &&
      !commitMessageLoading &&
      activeTask &&
      activeProject
    ) {
      // Always re-check git status when this stage is rendered as current + awaiting_user
      // This handles: app restart, navigation back to stage, external commits
      generatePendingCommit(activeTask, stage, activeProject.path, activeProject.id).catch(() => {});
    }
  }, [isCurrentStage, stageStatus, isRunning, committedHash, activeTask?.id, activeProject?.id]);

  // Timeout fallback: if commit preparation takes too long, let the user approve manually
  useEffect(() => {
    if (
      isCurrentStage &&
      stageStatus === "awaiting_user" &&
      !isRunning &&
      !hasPendingCommitForThisStage &&
      !noChangesToCommit &&
      !committedHash
    ) {
      setCommitPrepTimedOut(false);
      const timer = setTimeout(() => setCommitPrepTimedOut(true), 5000);
      return () => clearTimeout(timer);
    }
    setCommitPrepTimedOut(false);
  }, [isCurrentStage, stageStatus, isRunning, hasPendingCommitForThisStage, noChangesToCommit, committedHash]);

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
      logger.error("Failed to run stage:", err);
      setStageError(err instanceof Error ? err.message : String(err));
    }
  };

  const handleApprove = async (decision?: string) => {
    if (!activeProject || !activeTask) return;
    setApproving(true);
    setStageError(null);
    // Clear commit-related state so it doesn't leak into the next stage
    if (noChangesToCommit) {
      useProcessStore.getState().setNoChangesToCommit(null);
    }
    useProcessStore.getState().clearPendingCommit();
    try {
      await approveStage(activeTask, stage, decision);
      sendNotification("Stage approved", stage.name, "success", { projectId: activeProject.id, taskId: activeTask.id });
    } catch (err) {
      logger.error("Failed to approve stage:", err);
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
      logger.error("Failed to redo stage:", err);
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
    // Clear commit-related state so it doesn't leak into the next stage
    useProcessStore.getState().clearPendingCommit();
    useProcessStore.getState().setNoChangesToCommit(null);
    try {
      let ids = [...selectedStageIds];
      const hasPrCreator = stageTemplates.some(
        (t) => ids.includes(t.id) && t.output_format === "pr_preparation",
      );
      if (hasPrCreator) {
        const prReviewTemplate = stageTemplates.find((t) => t.output_format === "pr_review");
        if (prReviewTemplate && !ids.includes(prReviewTemplate.id)) {
          ids.push(prReviewTemplate.id);
        }
      }

      const stages = ids
        .map((id) => {
          const t = stageTemplates.find((s) => s.id === id);
          return t ? { stageTemplateId: id, sortOrder: t.sort_order } : null;
        })
        .filter((s): s is { stageTemplateId: string; sortOrder: number } => s !== null);

      await setTaskStages(activeProject.id, activeTask.id, stages);
      await approveStage(activeTask, stage);
    } catch (err) {
      logger.error("Failed to approve with stages:", err);
      setStageError(err instanceof Error ? err.message : String(err));
      setApproving(false);
    }
  };

  const handleSplitTask = async (subtasks: { title: string; description: string }[]) => {
    if (!activeProject || !activeTask) return;
    setApproving(true);
    setStageError(null);
    try {
      if (subtasks.length > 0) {
        // 1. Create child tasks in the database
        await useTaskStore.getState().createSubtasks(
          activeProject.id,
          activeTask.id,
          subtasks,
        );
        // 2. Update parent task status to "split" (terminal)
        await useTaskStore.getState().updateTask(
          activeProject.id,
          activeTask.id,
          { status: "split" },
        );
      }
      // 3. Approve the split stage (marks execution as approved)
      await approveStage(activeTask, stage);
    } catch (err) {
      logger.error("Failed to split task:", err);
      setStageError(err instanceof Error ? err.message : String(err));
      setApproving(false);
    }
  };

  if (!activeProject || !activeTask) return null;

  // Ejected: full-screen overlay blocking all stage interaction
  if (activeTask.ejected) {
    return (
      <div className="flex-1 flex items-center justify-center h-full bg-background/80 backdrop-blur-sm">
        <div className="text-center space-y-4 max-w-md">
          <svg
            className="w-12 h-12 mx-auto text-muted-foreground/50"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
            strokeWidth={1.5}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M5 10l7-7m0 0l7 7m-7-7v18"
            />
          </svg>
          <h2 className="text-lg font-semibold">Task Ejected</h2>
          <p className="text-sm text-muted-foreground">
            This task's branch is currently checked out in your main project
            directory. Edit and test your code there, then click{" "}
            <strong>Inject</strong> in the header to resume the pipeline.
          </p>
        </div>
      </div>
    );
  }

  // Merge: custom rendering
  if (stage.output_format === "merge") {
    return <MergeStageView stage={stage} />;
  }

  // Interactive Terminal: self-contained PTY-based stage
  if (stage.output_format === "interactive_terminal") {
    return <InteractiveTerminalStageView stage={stage} />;
  }

  // PR Review: delegated to dedicated subcomponent
  if (stage.output_format === "pr_review") {
    return (
      <PrReviewView
        stage={stage}
        task={activeTask}
      />
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
          <svg className="w-8 h-8 mx-auto mb-2 text-zinc-300 dark:text-zinc-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <p className="text-sm">Waiting for earlier stages to complete</p>
        </div>
      )}

      {/* Initial form -- only when nothing has run yet */}
      {showInitialForm && (
        <StageInputArea
          needsUserInput={needsUserInput}
          userInput={userInput}
          onUserInputChange={setUserInput}
          stageError={stageError}
          isRunning={isRunning}
          onRun={handleRun}
        />
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

          {(stage.output_format === "research" || stage.output_format === "findings" || stage.output_format === "task_splitting") && (
            <Alert className={`mb-4 ${
              stage.output_format === "task_splitting"
                ? "border-violet-200 dark:border-violet-500/20 bg-violet-50 dark:bg-violet-500/10 text-violet-800 dark:text-violet-300"
                : "border-emerald-200 dark:border-emerald-500/20 bg-emerald-50 dark:bg-emerald-500/10 text-emerald-800 dark:text-emerald-300"
            }`}>
              <svg className={`w-4 h-4 flex-shrink-0 ${
                stage.output_format === "task_splitting"
                  ? "text-violet-600 dark:text-violet-400"
                  : "text-emerald-600 dark:text-emerald-400"
              }`} fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
              </svg>
              <AlertDescription className={
                stage.output_format === "task_splitting"
                  ? "text-violet-800 dark:text-violet-300"
                  : "text-emerald-800 dark:text-emerald-300"
              }>
                {stage.output_format === "task_splitting"
                  ? "Task Split Successfully"
                  : stage.output_format === "research"
                  ? "Research Complete"
                  : (() => {
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
        <Alert className="mb-6 border-emerald-200 dark:border-emerald-500/20 bg-emerald-50 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-400">
          <svg className="w-4 h-4 text-emerald-600 dark:text-emerald-400" fill="currentColor" viewBox="0 0 20 20">
            <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
          </svg>
          <AlertDescription className="text-emerald-700 dark:text-emerald-400">
            Committed: <code className="font-mono">{committedHash}</code>
          </AlertDescription>
        </Alert>
      )}

      {/* RUNNING / AWAITING: live timeline */}
      {(latestExecution || isRunning) && !isApproved && !showInitialForm && (
        <div className="relative mb-6">
          <div className="absolute left-3 top-3 bottom-3 w-px bg-border" />

          {pastExecs.length > 0 && (
            <StageTimeline executions={pastExecs} stage={stage} />
          )}

          {latestExecution?.user_input && (
            !stage.requires_user_input ? (
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

          {(stageStatus === "running" || isRunning) && (
            <LiveStreamBubble
              stageKey={sk}
              label={`${stage.name} working...`}
              onStop={() => killCurrent(activeTask!.id, stage.id)}
            />
          )}

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
                onApproveWithStages={stage.output_format === "research" ? handleApproveWithStages : undefined}
                onSubmitAnswers={handleSubmitAnswers}
                onSplitTask={stage.output_format === "task_splitting" ? handleSplitTask : undefined}
                isApproved={false}
                stageTemplates={stage.output_format === "research" ? stageTemplates : undefined}
                approving={approving}
              />

              {/* Inline commit workflow */}
              {isCurrentStage && (
                <CommitWorkflow
                  pendingCommit={pendingCommit}
                  stageId={stage.id}
                  commitMessage={commitMessage}
                  setCommitMessage={setCommitMessage}
                  commitError={commitError}
                  committing={committing}
                  onCommit={handleCommit}
                  noChangesToCommit={noChangesToCommit}
                  outputHasOwnActionButton={outputHasOwnActionButton}
                  onApprove={() => handleApprove()}
                  approving={approving}
                  commitPrepTimedOut={commitPrepTimedOut}
                />
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
