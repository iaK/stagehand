import { useState, useMemo, useEffect, useRef } from "react";
import { useProjectStore } from "../../stores/projectStore";
import { useTaskStore } from "../../stores/taskStore";
import { useProcessStore, stageKey } from "../../stores/processStore";
import { useStageExecution, generatePendingCommit, createWorktreeForTask } from "../../hooks/useStageExecution";
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
import { gitAdd, gitCommit, hasUncommittedChanges } from "../../lib/git";
import { getTaskWorkingDir } from "../../lib/worktree";
import { spawnAgent } from "../../lib/agent";
import type { AgentStreamEvent } from "../../lib/types";
import { MergeStageView } from "./MergeStageView";
import { PrReviewView } from "./PrReviewView";
import { InteractiveTerminalStageView } from "./InteractiveTerminalStageView";
import { CommitWorkflow } from "./CommitWorkflow";
import { StageInputArea } from "./StageInputArea";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from "@/components/ui/collapsible";
import { Select, SelectContent, SelectItem, SelectSeparator, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2 } from "lucide-react";
import { sendNotification } from "../../lib/notifications";
import { logger } from "../../lib/logger";
import * as repo from "../../lib/repositories";
import type { TaskStageInstance, CompletionStrategy } from "../../lib/types";

interface StageViewProps {
  stage: TaskStageInstance;
  taskId: string;
}

export function StageView({ stage, taskId }: StageViewProps) {
  const activeProject = useProjectStore((s) => s.activeProject);
  const tasks = useTaskStore((s) => s.tasks);
  const storeTask = useMemo(() => tasks.find((t) => t.id === taskId) ?? null, [tasks, taskId]);
  // Cache the task so it survives project switches (store.tasks gets replaced)
  const taskRef = useRef(storeTask);
  if (storeTask) taskRef.current = storeTask;
  const task = storeTask ?? taskRef.current;
  const executions = useTaskStore((s) => s.executions);
  const stageTemplates = useTaskStore((s) => s.stageTemplates);
  const sid = stage.task_stage_id;
  const sk = task ? stageKey(task.id, sid) : sid;
  const isRunning = useProcessStore((s) => s.stages[sk]?.isRunning ?? false);
  const pendingCommit = useProcessStore((s) => s.pendingCommit);
  const committedHash = useProcessStore((s) => s.committedStages[sid]);
  const noChangesToCommit = useProcessStore((s) => s.noChangesStageId === sid);
  const { runStage, approveStage, suggestNextStage, chooseNextStage, redoStage, killCurrent } =
    useStageExecution();
  useProcessHealthCheck(sid, taskId);
  const [userInput, setUserInput] = useState("");
  // Tracks whether the user has manually edited the textarea since this StageView
  // mounted. Used by the pre-fill effect to avoid overwriting intentional edits.
  const hasUserEdited = useRef(false);
  const [feedback, setFeedback] = useState("");
  const [showFeedback, setShowFeedback] = useState(false);
  const [showTimeline, setShowTimeline] = useState(false);
  const [commitMessage, setCommitMessage] = useState("");
  const [committing, setCommitting] = useState(false);
  const [commitError, setCommitError] = useState<string | null>(null);
  const [approving, setApproving] = useState(false);
  const cachedSuggestion = useProcessStore((s) => s.stageSuggestions[sid]);
  // Seed from in-memory cache first, then fall back to DB-persisted suggestion
  const initialSuggestion = cachedSuggestion ?? (
    stage.suggested_next_template_id ? { suggestedTemplateId: stage.suggested_next_template_id, reason: stage.suggestion_reason } : null
  );
  const [loadingNextSuggestion, setLoadingNextSuggestion] = useState(false);
  const [nextSuggestionReason, setNextSuggestionReason] = useState<string | null>(initialSuggestion?.reason ?? null);
  const [selectedNextTemplateId, setSelectedNextTemplateId] = useState<string | null>(initialSuggestion?.suggestedTemplateId ?? null);
  const [stageError, setStageError] = useState<string | null>(null);
  const [commitPrepTimedOut, setCommitPrepTimedOut] = useState(false);
  // Terminal output formats whose next stage is fixed (not user-selectable)
  const TERMINAL_FORMATS = ["pr_preparation", "pr_review", "merge"] as const;
  const isTerminalStage = (TERMINAL_FORMATS as readonly string[]).includes(stage.output_format);

  // For terminal stages, compute the fixed next template ID:
  // pr_preparation → pr_review, pr_review/merge → null (complete task)
  const terminalNextTemplateId = useMemo(() => {
    if (stage.output_format === "pr_preparation") {
      return stageTemplates.find((t) => t.output_format === "pr_review")?.id ?? null;
    }
    return null; // pr_review and merge complete the task
  }, [stage.output_format, stageTemplates]);

  // "Finish task" maps to the terminal stage based on project completion strategy
  const FINISH_TASK_VALUE = "__finish__";
  const [completionStrategy, setCompletionStrategy] = useState<CompletionStrategy>("pr");
  useEffect(() => {
    if (activeProject) {
      repo.getCompletionStrategy(activeProject.id).then(setCompletionStrategy);
    }
  }, [activeProject?.id]);
  const finishTemplateId = useMemo(() => {
    if (completionStrategy === "merge") {
      return stageTemplates.find((t) => t.output_format === "merge")?.id ?? null;
    }
    return stageTemplates.find((t) => t.output_format === "pr_preparation")?.id ?? null;
  }, [completionStrategy, stageTemplates]);

  // Sync editable commit message when pending commit appears for this stage
  useEffect(() => {
    if (pendingCommit?.stageId === sid) {
      setCommitMessage(pendingCommit.message);
    }
  }, [pendingCommit?.stageId, pendingCommit?.message, sid]);

  const handleCommit = async () => {
    if (!activeProject || !task || !pendingCommit || pendingCommit.stageId !== sid) return;
    setCommitting(true);
    setCommitError(null);
    try {
      const workDir = getTaskWorkingDir(task, activeProject.path);
      await gitAdd(workDir);
      const result = await gitCommit(workDir, commitMessage);
      const hashMatch = result.match(/\[[\w/.-]+\s+([a-f0-9]+)\]/);
      const shortHash = hashMatch?.[1] ?? result.slice(0, 7);
      useProcessStore.getState().setCommitted(sid, shortHash);
      useProcessStore.getState().clearPendingCommit();
      sendNotification("Changes committed", shortHash, "success", { projectId: activeProject.id, taskId: task.id });
      await approveStage(task, stage);
      const nextId = isTerminalStage ? terminalNextTemplateId : effectiveNextTemplateId;
      if (nextId !== null || isTerminalStage) {
        await chooseNextStage(task, stage, nextId);
      }
    } catch (e) {
      const workDirCheck = getTaskWorkingDir(task, activeProject.path);
      const stillHasChanges = await hasUncommittedChanges(workDirCheck).catch(() => false);
      if (!stillHasChanges) {
        // Working tree is clean — changes were already committed or there were none.
        // Just proceed with approval.
        useProcessStore.getState().clearPendingCommit();
        await approveStage(task, stage);
        const nextId = isTerminalStage ? terminalNextTemplateId : effectiveNextTemplateId;
        if (nextId !== null || isTerminalStage) {
          await chooseNextStage(task, stage, nextId);
        }
        return;
      }
      setCommitError(e instanceof Error ? e.message : String(e));
      // Re-check git status — if user committed externally, switch to continue button
      if (task && activeProject) {
        generatePendingCommit(task, stage, activeProject.path, activeProject.id).catch(() => {});
      }
    } finally {
      setCommitting(false);
    }
  };

  const handleCommitFix = async () => {
    if (!activeProject || !task || !commitError || !pendingCommit || pendingCommit.stageId !== sid) return;
    const workDir = getTaskWorkingDir(task, activeProject.path);
    const { setRunning, setStopped, appendOutput, clearOutput } = useProcessStore.getState();
    clearOutput(sk);
    setRunning(sk, "fixing");
    setCommitError(null);

    const prompt = `The following git commit failed with an error. Fix whatever is preventing the commit from succeeding.

Task: ${task.title}

Commit message attempted: "${commitMessage}"

${pendingCommit.diffStat ? `Changes being committed:\n${pendingCommit.diffStat}\n\n` : ""}Git error:
${commitError}

Investigate the error (read files, run checks) and fix the issue. Do NOT run git add, git commit, or any git staging/committing commands — the user will commit after reviewing your fixes.`;

    try {
      await new Promise<void>((resolve) => {
        spawnAgent(
          {
            prompt,
            workingDirectory: workDir,
            noSessionPersistence: true,
            outputFormat: "stream-json",
          },
          (event: AgentStreamEvent) => {
            switch (event.type) {
              case "started":
                setRunning(sk, event.process_id);
                break;
              case "stdout_line":
                try {
                  const parsed = JSON.parse(event.line);
                  if (parsed.type === "assistant" && parsed.message?.content) {
                    for (const block of parsed.message.content) {
                      if (block.type === "text") appendOutput(sk, block.text);
                    }
                  } else if (parsed.type === "result") {
                    const output = parsed.result;
                    if (output != null && output !== "") {
                      appendOutput(sk, typeof output === "string" ? output : JSON.stringify(output));
                    }
                  }
                } catch {
                  // Non-JSON lines are CLI UI noise — skip
                }
                break;
              case "stderr_line":
                appendOutput(sk, `[stderr] ${event.line}`);
                break;
              case "completed":
              case "error":
                setStopped(sk);
                resolve();
                break;
            }
          },
        ).catch(() => { setStopped(sk); resolve(); });
      });
    } finally {
      // Re-check git status so the commit workflow reflects what the agent changed
      generatePendingCommit(task, stage, activeProject.path, activeProject.id).catch(() => {});
    }
  };

  const stageExecs = useMemo(
    () =>
      executions
        // Legacy/race-recovery compatibility: old research executions may
        // still have NULL task_stage_id. Surface them in the Research stage.
        .filter((e) =>
          e.task_stage_id === sid || (stage.output_format === "research" && !e.task_stage_id),
        )
        .sort((a, b) => a.attempt_number - b.attempt_number),
    [executions, sid, stage.output_format],
  );

  const latestExecution = useMemo(
    () => (stageExecs.length > 0 ? stageExecs[stageExecs.length - 1] : null),
    [stageExecs],
  );

  const stageStatus = latestExecution?.status ?? "pending";
  const getActiveTaskStageInstances = useTaskStore((s) => s.getActiveTaskStageInstances);
  const allStages = useMemo(() => getActiveTaskStageInstances(), [getActiveTaskStageInstances, task?.id, task?.current_stage_id]);
  const isCurrentStage = useMemo(() => {
    // Direct match
    if (task?.current_stage_id === sid) return true;
    if (task?.current_stage_id == null && stage.sort_order === 0) return true;
    // Fallback: if current_stage_id doesn't match any known stage instance,
    // infer the current stage as the first non-approved one (same logic as PipelineStepper).
    const currentIdMatchesAny = task?.current_stage_id && allStages.some((s) => s.task_stage_id === task.current_stage_id);
    if (!currentIdMatchesAny && task?.status !== "completed" && task?.status !== "split" && allStages.length > 0) {
      const firstNonApproved = allStages.find((s) => {
        const execs = executions.filter((e) => e.task_stage_id === s.task_stage_id);
        return !execs.some((e) => e.status === "approved");
      });
      const inferredId = firstNonApproved?.task_stage_id ?? allStages[0].task_stage_id;
      return inferredId === sid;
    }
    return false;
  }, [task?.current_stage_id, task?.status, sid, stage.sort_order, allStages, executions]);
  const isApproved = stageStatus === "approved";
  // Whether this stage is before the current stage (passed through to get here)
  const isPastStage = useMemo(() => {
    if (isCurrentStage) return false;
    const currentSort = allStages.find((s) => s.task_stage_id === (task?.current_stage_id ?? ""))?.sort_order;
    if (currentSort == null) return false;
    return stage.sort_order < currentSort;
  }, [isCurrentStage, allStages, task?.current_stage_id, stage.sort_order]);
  const needsUserInput = !!stage.requires_user_input;

  // Determine whether the output component renders its own action button.
  const outputHasOwnActionButton = useMemo(() => {
    if (!latestExecution) return false;
    const output = latestExecution.parsed_output ?? latestExecution.raw_output ?? "";
    return formatHasOwnActionButton(output, stage.output_format);
  }, [!!latestExecution, latestExecution?.parsed_output, latestExecution?.raw_output, stage.output_format]);

  // True when the output has pending interactions that will trigger a redo (not an approve).
  // Covers: question cards (research/plan Q&A) and Phase 1 findings (selectable findings).
  // In this state, hide the next-stage picker since the stage will re-run.
  const hasPendingQuestions = useMemo(() => {
    if (!latestExecution) return false;
    const output = latestExecution.parsed_output ?? latestExecution.raw_output ?? "";
    try {
      const parsed = JSON.parse(output);
      if ((parsed.questions ?? []).length > 0) return true;
      // Phase 1 findings with actual items: user selects findings → Apply triggers redo, not approve.
      // Empty findings array means "no findings" — user approves directly, so show next stage selector.
      if (Array.isArray(parsed.findings) && parsed.findings.length > 0) return true;
      return false;
    } catch {
      return false;
    }
  }, [!!latestExecution, latestExecution?.parsed_output, latestExecution?.raw_output]);

  // Re-generate pending commit on mount/navigation if the stage is awaiting_user
  // but no commit dialog is present (e.g. after app restart where in-memory state was lost,
  // or a stale pendingCommit from a different stage is still in the store).
  // Skip if a valid pending commit already exists for this task+stage to avoid
  // unnecessarily clearing and regenerating on tab switches (which causes the
  // "Preparing commit..." spinner to flash or get stuck if git ops are slow).
  const commitMessageLoading = useProcessStore((s) => s.commitMessageLoadingStageId === sid);
  const hasPendingCommitForThisStage = pendingCommit?.stageId === sid && pendingCommit?.taskId === task?.id;
  useEffect(() => {
    if (
      isCurrentStage &&
      stageStatus === "awaiting_user" &&
      !isRunning &&
      !committedHash &&
      !commitMessageLoading &&
      !hasPendingCommitForThisStage &&
      !noChangesToCommit &&
      task &&
      activeProject
    ) {
      // Re-check git status when this stage is rendered as current + awaiting_user
      // AND there's no existing commit state. This handles: app restart, navigation
      // back to stage after state was lost, external commits.
      generatePendingCommit(task, stage, activeProject.path, activeProject.id).catch(() => {});
    }
  }, [isCurrentStage, stageStatus, isRunning, committedHash, commitMessageLoading, hasPendingCommitForThisStage, noChangesToCommit, task?.id, activeProject?.id]);

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

  // Pre-fill research input with initial input (e.g. from Linear import).
  // Consumed once from localStorage so it survives app restarts but is cleared
  // after first use. latestExecution is in deps so the effect re-runs once async
  // loadExecutions completes — fixing the race where stale executions from a
  // previous task caused the !latestExecution guard to incorrectly block pre-fill.
  //
  // hasUserEdited prevents this effect from overwriting text the user has already
  // typed. The ref resets to false on every remount (i.e. every task switch),
  // so the guard is scoped to the current StageView instance.
  const consumeInitialInput = useTaskStore((s) => s.consumeInitialInput);
  useEffect(() => {
    if (task && needsUserInput && !latestExecution && !hasUserEdited.current) {
      const input = consumeInitialInput(task.id);
      if (input) setUserInput(input);
    }
  }, [task?.id, needsUserInput, latestExecution]);

  // Past completed rounds (everything except the latest)
  const pastExecs = useMemo(
    () => (stageExecs.length > 1 ? stageExecs.slice(0, -1) : []),
    [stageExecs],
  );

  const handleRun = async () => {
    if (!task) return;
    setStageError(null);
    try {
      await runStage(task, stage, userInput || undefined);
    } catch (err) {
      logger.error("Failed to run stage:", err);
      setStageError(err instanceof Error ? err.message : String(err));
    }
  };

  const handleApprove = async (decision?: string, branchName?: string, baseBranch?: string) => {
    if (!activeProject || !task) return;
    setApproving(true);
    setStageError(null);
    // Clear commit-related state so it doesn't leak into the next stage
    if (noChangesToCommit) {
      useProcessStore.getState().setNoChangesToCommit(null);
    }
    useProcessStore.getState().clearPendingCommit();
    try {
      // Create worktree when approving research (branch info provided)
      let effectiveTask = task;
      if (branchName && baseBranch && !task.worktree_path) {
        try {
          effectiveTask = await createWorktreeForTask(
            activeProject.id, activeProject.path, task, branchName, baseBranch,
          );
        } catch (err) {
          // Worktree creation is non-critical — continue in project root
          logger.warn("Worktree creation failed, continuing in project root:", err);
        }
      }
      await approveStage(effectiveTask, stage, decision);
      sendNotification("Stage approved", stage.name, "success", { projectId: activeProject.id, taskId: task.id });
      // Advance to the selected next stage in one action.
      // Terminal stages have a fixed next stage (pr_preparation → pr_review, others → complete).
      // If no next stage is selected yet (e.g. approve triggered by an output action button
      // before the user picked a stage), skip advancing — the approved state will show
      // the next stage selector so the user can choose and continue.
      const nextId = isTerminalStage ? terminalNextTemplateId : effectiveNextTemplateId;
      if (nextId !== null || isTerminalStage) {
        await chooseNextStage(effectiveTask, stage, nextId);
      } else {
        setApproving(false);
      }
    } catch (err) {
      logger.error("Failed to approve stage:", err);
      setStageError(err instanceof Error ? err.message : String(err));
      setApproving(false);
    }
  };

  const handleRedo = async () => {
    if (!task) return;
    useProcessStore.getState().clearPendingCommit();
    useProcessStore.getState().setNoChangesToCommit(null);
    setShowFeedback(false);
    setStageError(null);
    try {
      await redoStage(task, stage, feedback || undefined);
      setFeedback("");
    } catch (err) {
      logger.error("Failed to redo stage:", err);
      setStageError(err instanceof Error ? err.message : String(err));
    }
  };

  const handleSubmitAnswers = async (answers: string) => {
    if (!task) return;
    setStageError(null);
    await redoStage(task, stage, answers);
  };


  const handleSplitTask = async (subtasks: { title: string; initialInput?: string }[]) => {
    if (!activeProject || !task) return;
    setApproving(true);
    setStageError(null);
    try {
      if (subtasks.length > 0) {
        // 1. Create child tasks in the database
        await useTaskStore.getState().createSubtasks(
          activeProject.id,
          task.id,
          subtasks,
        );
        // 2. Update parent task status to "split" (terminal)
        await useTaskStore.getState().updateTask(
          activeProject.id,
          task.id,
          { status: "split" },
        );
      }
      // 3. Approve the split stage (marks execution as approved)
      await approveStage(task, stage);
    } catch (err) {
      logger.error("Failed to split task:", err);
      setStageError(err instanceof Error ? err.message : String(err));
      setApproving(false);
    }
  };

  // Pre-fetch next stage suggestion while user is reviewing output (awaiting_user).
  // Only fire when the output doesn't have interactive controls (e.g. question cards)
  // so we don't waste an agent call during the Q&A phase.
  const isAwaitingUser = stageStatus === "awaiting_user" && !isRunning;
  const readyForSuggestion = (isAwaitingUser && !hasPendingQuestions) || isApproved;
  useEffect(() => {
    if (!task || !isCurrentStage || !readyForSuggestion || isTerminalStage || task.status === "completed" || task.status === "split") return;
    // Check in-memory cache first, then DB-persisted suggestion
    const cached = useProcessStore.getState().stageSuggestions[sid];
    if (cached) return;
    if (stage.suggested_next_template_id) {
      // Restore from DB into in-memory cache
      const dbSuggestion = { suggestedTemplateId: stage.suggested_next_template_id, reason: stage.suggestion_reason };
      useProcessStore.getState().setStageSuggestion(sid, dbSuggestion);
      setSelectedNextTemplateId(dbSuggestion.suggestedTemplateId);
      setNextSuggestionReason(dbSuggestion.reason);
      return;
    }
    let cancelled = false;
    setLoadingNextSuggestion(true);
    setNextSuggestionReason(null);
    suggestNextStage(task, stage)
      .then((result) => {
        if (cancelled) return;
        const suggestion = { suggestedTemplateId: result.suggestedTemplateId ?? null, reason: result.reason ?? null };
        useProcessStore.getState().setStageSuggestion(sid, suggestion);
        setSelectedNextTemplateId(suggestion.suggestedTemplateId);
        setNextSuggestionReason(suggestion.reason);
        // Persist to DB so it survives task/project switches
        if (activeProject) {
          repo.saveStageSuggestion(activeProject.id, sid, suggestion.suggestedTemplateId, suggestion.reason).catch(() => {});
        }
      })
      .catch((err) => {
        logger.error("Failed to suggest next stage:", err);
      })
      .finally(() => {
        if (!cancelled) setLoadingNextSuggestion(false);
      });
    return () => { cancelled = true; };
  }, [task?.id, stage.task_stage_id, isCurrentStage, readyForSuggestion, task?.status, suggestNextStage]);

  const showInitialForm =
    isCurrentStage && !isRunning && (stageStatus === "pending" || !latestExecution);

  // Filter stage templates shown in the next-stage picker:
  // - Terminal stages (pr_preparation, pr_review, merge) are never shown as user-selectable
  //   next stages; the AI suggestion handles routing to them.
  const selectableTemplates = useMemo(() => {
    if (isTerminalStage) return [];
    return stageTemplates.filter((t) => {
      if ((TERMINAL_FORMATS as readonly string[]).includes(t.output_format)) return false;
      if (t.output_format === "research") return false;
      if (!t.can_follow) return true; // null = no restriction
      try {
        const canFollow: string[] = JSON.parse(t.can_follow);
        return canFollow.includes(stage.name);
      } catch {
        return true;
      }
    });
  }, [stageTemplates, isTerminalStage, stage.name]);

  // Clear stale selection if the chosen template was deleted
  useEffect(() => {
    if (
      selectedNextTemplateId &&
      selectedNextTemplateId !== FINISH_TASK_VALUE &&
      !selectableTemplates.some((t) => t.id === selectedNextTemplateId)
    ) {
      setSelectedNextTemplateId(null);
    }
  }, [selectableTemplates, selectedNextTemplateId]);

  // Resolve the effective template ID: FINISH_TASK_VALUE maps to the terminal stage
  const effectiveNextTemplateId = selectedNextTemplateId === FINISH_TASK_VALUE
    ? finishTemplateId
    : selectedNextTemplateId;

  if (!activeProject || !task) return null;

  // Ejected: full-screen overlay blocking all stage interaction
  if (task.ejected) {
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
    return <InteractiveTerminalStageView stage={stage} taskId={taskId} />;
  }

  // PR Review: delegated to dedicated subcomponent
  if (stage.output_format === "pr_review") {
    return (
      <PrReviewView
        stage={stage}
        task={task}
      />
    );
  }

  const nextStageSelectorNode = isTerminalStage ? null : (
    <div className="mb-3">
      <label className="text-xs font-medium text-foreground">Next Stage</label>
      {loadingNextSuggestion ? (
        <p className="mt-1 text-xs text-muted-foreground">Analyzing...</p>
      ) : (
        <>
          <Select
            value={selectedNextTemplateId ?? ""}
            onValueChange={(value) => setSelectedNextTemplateId(value || null)}
          >
            <SelectTrigger className="mt-1 h-8 text-sm w-full">
              <SelectValue placeholder="Select next stage..." />
            </SelectTrigger>
            <SelectContent className="max-w-[360px]">
              {selectableTemplates.map((t) => (
                <SelectItem key={t.id} value={t.id} description={t.description ?? undefined}>
                  {t.name}
                </SelectItem>
              ))}
              {finishTemplateId && (
                <>
                  <SelectSeparator />
                  <SelectItem
                    value={FINISH_TASK_VALUE}
                    description={completionStrategy === "merge"
                      ? "Merge changes into the base branch"
                      : "Prepare and create a pull request"}
                  >
                    Finish task ({completionStrategy === "merge" ? "merge" : "PR"})
                  </SelectItem>
                </>
              )}
            </SelectContent>
          </Select>
          {nextSuggestionReason && (
            <p className="mt-3 mb-2 text-xs text-muted-foreground italic border-l-2 border-border pl-2">{nextSuggestionReason}</p>
          )}
        </>
      )}
    </div>
  );

  return (
    <div className="p-6 max-w-4xl">
      {latestExecution && latestExecution.attempt_number > 1 && (
        <p className="text-xs text-muted-foreground mb-4">
          Attempt #{latestExecution.attempt_number}
        </p>
      )}

      {/* Past stage -- before current, but no execution data (mismatched IDs) */}
      {!isCurrentStage && !latestExecution && isPastStage && (
        <div className="mb-6 py-6 text-center text-muted-foreground">
          <svg className="w-8 h-8 mx-auto mb-2 text-emerald-300 dark:text-emerald-700" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M5 13l4 4L19 7" />
          </svg>
          <p className="text-sm">Stage completed</p>
        </div>
      )}

      {/* Future stage -- not current, nothing has run, after current stage */}
      {!isCurrentStage && !latestExecution && !isPastStage && (
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
          onUserInputChange={(v) => { hasUserEdited.current = true; setUserInput(v); }}
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
            <div className="mb-4 flex items-center gap-2 text-xs text-muted-foreground">
              <span className={`inline-block w-1.5 h-1.5 rounded-full ${
                stage.output_format === "task_splitting" ? "bg-violet-500" : "bg-emerald-500"
              }`} />
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
            </div>
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

          {/* Stage approved but no next stage chosen yet — show selector so user can continue */}
          {isCurrentStage && !isTerminalStage && task.status !== "completed" && task.status !== "split" && (
            <div className="mt-4 p-4 bg-muted/50 border border-border rounded-lg space-y-3">
              {nextStageSelectorNode}
              <Button
                onClick={async () => {
                  const nextId = effectiveNextTemplateId;
                  if (!nextId || !task) return;
                  setApproving(true);
                  try {
                    await chooseNextStage(task, stage, nextId);
                  } catch (err) {
                    logger.error("Failed to advance stage:", err);
                    setStageError(err instanceof Error ? err.message : String(err));
                    setApproving(false);
                  }
                }}
                disabled={approving || loadingNextSuggestion || !effectiveNextTemplateId}
              >
                {approving && <Loader2 className="w-4 h-4 animate-spin" />}
                {approving ? "Continuing..." : "Continue"}
              </Button>
            </div>
          )}

        </div>
      )}

      {/* COMMITTED BADGE */}
      {committedHash && isApproved && (
        <div className="mb-6 flex items-center gap-2 text-xs text-muted-foreground">
          <span className="inline-block w-1.5 h-1.5 rounded-full bg-emerald-500" />
          Committed <code className="font-mono text-foreground/70">{committedHash}</code>
        </div>
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
              onStop={() => killCurrent(task!.id, sid)}
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
                onSubmitAnswers={handleSubmitAnswers}
                onSplitTask={stage.output_format === "task_splitting" ? handleSplitTask : undefined}
                isApproved={false}
                approving={approving}
                nextStageSelector={isCurrentStage && !hasPendingQuestions ? nextStageSelectorNode : undefined}
                nextStageLoading={isCurrentStage && !hasPendingQuestions ? loadingNextSuggestion : undefined}
              />

              {/* Next stage selector + approve button for formats that don't embed them internally.
                  Formats like plan, research, findings, options, etc. render their own action
                  buttons via props. Commit stages render the selector above CommitWorkflow below.
                  Use the dynamic outputHasOwnActionButton check instead of hardcoded format list
                  so custom/auto stages always get a button when the output is plain text. */}
              {isCurrentStage && !hasPendingQuestions && !stage.commits_changes
                && !outputHasOwnActionButton
                && (
                <div className="mt-4 p-4 bg-muted/50 border border-border rounded-lg space-y-3">
                  {nextStageSelectorNode}
                  <Button
                    onClick={() => handleApprove()}
                    disabled={approving || loadingNextSuggestion}
                  >
                    {approving && <Loader2 className="w-4 h-4 animate-spin" />}
                    {approving ? "Approving..." : "Approve & Continue"}
                  </Button>
                </div>
              )}

              {/* Inline commit workflow — only for stages that modify files */}
              {isCurrentStage && !hasPendingQuestions && !!stage.commits_changes && (
                <CommitWorkflow
                  pendingCommit={pendingCommit}
                  stageId={sid}
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
                  onAskAgentToFix={handleCommitFix}
                  agentFixRunning={isRunning}
                  nextStageSelector={!hasPendingQuestions ? nextStageSelectorNode : undefined}
                  nextStageLoading={!hasPendingQuestions ? (loadingNextSuggestion || !effectiveNextTemplateId) : undefined}
                  workingDir={activeProject && task ? getTaskWorkingDir(task, activeProject.path) : undefined}
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
                    <button
                      className="text-xs text-muted-foreground hover:text-foreground transition-colors"
                      onClick={() => setShowFeedback(true)}
                    >
                      💩 Not great? Redo with feedback
                    </button>
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
                <div className="mt-4 p-4 bg-muted/50 border border-border rounded-lg">
                  <Button
                    variant="warning"
                    onClick={handleRun}
                    disabled={isRunning}
                  >
                    Retry
                  </Button>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
