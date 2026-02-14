import { useState, useMemo } from "react";
import { useProjectStore } from "../../stores/projectStore";
import { useTaskStore } from "../../stores/taskStore";
import { useProcessStore } from "../../stores/processStore";
import { useStageExecution } from "../../hooks/useStageExecution";
import { StageOutput } from "./StageOutput";
import {
  StageTimeline,
  UserBubble,
  LiveStreamBubble,
  ThinkingBubble,
} from "./StageTimeline";
import type { StageTemplate } from "../../lib/types";

interface StageViewProps {
  stage: StageTemplate;
}

export function StageView({ stage }: StageViewProps) {
  const activeProject = useProjectStore((s) => s.activeProject);
  const { activeTask, executions } = useTaskStore();
  const { isRunning, streamOutput } = useProcessStore();
  const { runStage, approveStage, redoStage, killCurrent } =
    useStageExecution();
  const [userInput, setUserInput] = useState("");
  const [feedback, setFeedback] = useState("");
  const [showFeedback, setShowFeedback] = useState(false);
  const [showTimeline, setShowTimeline] = useState(false);

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
  const hasHistory = stageExecs.length > 1;
  const needsUserInput =
    stage.input_source === "user" || stage.input_source === "both";

  // Past completed rounds (everything except the latest)
  const pastExecs = useMemo(
    () => (stageExecs.length > 1 ? stageExecs.slice(0, -1) : []),
    [stageExecs],
  );

  const handleRun = async () => {
    if (!activeTask) return;
    await runStage(activeTask, stage, userInput || undefined);
  };

  const handleApprove = async (decision?: string) => {
    if (!activeTask) return;
    await approveStage(activeTask, stage, decision);
  };

  const handleRedo = async () => {
    if (!activeTask) return;
    setShowFeedback(false);
    await redoStage(activeTask, stage, feedback || undefined);
    setFeedback("");
  };

  const handleSubmitAnswers = async (answers: string) => {
    if (!activeTask) return;
    await redoStage(activeTask, stage, answers);
  };

  if (!activeProject || !activeTask) return null;

  const showInitialForm =
    isCurrentStage && (stageStatus === "pending" || !latestExecution);

  return (
    <div className="p-6 max-w-4xl">
      {/* Stage Header */}
      <div className="mb-6">
        <h2 className="text-xl font-semibold text-zinc-100">{stage.name}</h2>
        <p className="text-sm text-zinc-500 mt-1">{stage.description}</p>
        {latestExecution && latestExecution.attempt_number > 1 && (
          <p className="text-xs text-zinc-600 mt-1">
            Attempt #{latestExecution.attempt_number}
          </p>
        )}
      </div>

      {/* Initial form — only when nothing has run yet */}
      {showInitialForm && (
        <div className="mb-6">
          {needsUserInput && (
            <div className="mb-4">
              <label className="block text-sm text-zinc-400 mb-2">
                {stage.input_source === "both"
                  ? "Additional context or feedback"
                  : "Describe what you need"}
              </label>
              <textarea
                value={userInput}
                onChange={(e) => setUserInput(e.target.value)}
                rows={4}
                className="w-full bg-zinc-900 text-zinc-100 border border-zinc-700 rounded-lg px-4 py-3 text-sm focus:outline-none focus:border-blue-500 resize-none"
                placeholder="Enter additional context..."
              />
            </div>
          )}
          <button
            onClick={handleRun}
            disabled={isRunning}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-500 disabled:bg-zinc-700 disabled:text-zinc-500 text-white rounded-lg text-sm font-medium transition-colors"
          >
            Run Stage
          </button>
        </div>
      )}

      {/* ── APPROVED: final result + collapsible timeline ── */}
      {latestExecution && isApproved && (
        <div className="mb-6">
          {stage.output_format === "research" && (
            <div className="mb-4 p-3 bg-emerald-950/30 border border-emerald-800 rounded-lg flex items-center gap-2">
              <svg className="w-4 h-4 text-emerald-400 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
              </svg>
              <span className="text-sm font-medium text-emerald-300">Research Complete</span>
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

          {hasHistory && (
            <div className="mt-4">
              <button
                onClick={() => setShowTimeline(!showTimeline)}
                className="flex items-center gap-1.5 text-xs text-zinc-500 hover:text-zinc-300 transition-colors"
              >
                <svg
                  className={`w-3 h-3 transition-transform ${showTimeline ? "rotate-90" : ""}`}
                  fill="currentColor"
                  viewBox="0 0 20 20"
                >
                  <path fillRule="evenodd" d="M7.293 14.707a1 1 0 010-1.414L10.586 10 7.293 6.707a1 1 0 011.414-1.414l4 4a1 1 0 010 1.414l-4 4a1 1 0 01-1.414 0z" clipRule="evenodd" />
                </svg>
                {showTimeline ? "Hide" : "Show"} process ({stageExecs.length} rounds)
              </button>
              {showTimeline && (
                <div className="mt-3">
                  <StageTimeline executions={stageExecs} stage={stage} />
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* ── RUNNING / AWAITING: live timeline ── */}
      {latestExecution && !isApproved && !showInitialForm && (
        <div className="relative mb-6">
          {/* Vertical line for the whole timeline */}
          <div className="absolute left-3 top-3 bottom-3 w-px bg-zinc-800" />

          {/* Past completed rounds */}
          {pastExecs.length > 0 && (
            <StageTimeline executions={pastExecs} stage={stage} />
          )}

          {/* Current round: user input */}
          {latestExecution.user_input && (
            <UserBubble
              text={latestExecution.user_input}
              label={latestExecution.attempt_number === 1 ? "Your input" : "Your answers"}
            />
          )}

          {/* Current round: RUNNING — live stream */}
          {stageStatus === "running" && (
            <LiveStreamBubble
              streamLines={streamOutput}
              label={`${stage.name} working...`}
              onStop={killCurrent}
            />
          )}

          {/* Current round: DONE — interactive output */}
          {stageStatus === "awaiting_user" && (
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
                isApproved={false}
              />

              {/* Redo actions */}
              {isCurrentStage && (
                <div className="flex items-start gap-3 mt-4">
                  {!showFeedback && (
                    <button
                      onClick={() => setShowFeedback(true)}
                      className="px-4 py-2 border border-zinc-700 text-zinc-300 hover:bg-zinc-800 rounded-lg text-sm transition-colors"
                    >
                      Redo with Feedback
                    </button>
                  )}
                  {showFeedback && (
                    <div className="flex-1 max-w-lg">
                      <textarea
                        value={feedback}
                        onChange={(e) => setFeedback(e.target.value)}
                        rows={3}
                        className="w-full bg-zinc-900 text-zinc-100 border border-zinc-700 rounded-lg px-4 py-3 text-sm focus:outline-none focus:border-blue-500 resize-none mb-2"
                        placeholder="What should be changed?"
                        autoFocus
                      />
                      <div className="flex gap-2">
                        <button
                          onClick={handleRedo}
                          className="px-3 py-1.5 bg-amber-600 hover:bg-amber-500 text-white rounded text-sm transition-colors"
                        >
                          Redo
                        </button>
                        <button
                          onClick={() => setShowFeedback(false)}
                          className="px-3 py-1.5 text-zinc-500 hover:text-zinc-300 text-sm transition-colors"
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Current round: FAILED */}
          {stageStatus === "failed" && (
            <div className="pl-9">
              {latestExecution.error_message && (
                <div className="p-4 bg-red-950/30 border border-red-900 rounded-lg text-sm text-red-400">
                  {latestExecution.error_message}
                </div>
              )}
              {isCurrentStage && (
                <button
                  onClick={handleRun}
                  disabled={isRunning}
                  className="mt-4 px-4 py-2 bg-amber-600 hover:bg-amber-500 text-white rounded-lg text-sm font-medium transition-colors"
                >
                  Retry
                </button>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
