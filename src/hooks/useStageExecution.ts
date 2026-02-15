import { useCallback } from "react";
import { useProjectStore } from "../stores/projectStore";
import { useTaskStore } from "../stores/taskStore";
import { useProcessStore } from "../stores/processStore";
import { spawnClaude, killProcess } from "../lib/claude";
import { renderPrompt } from "../lib/prompt";
import * as repo from "../lib/repositories";
import type {
  Task,
  StageTemplate,
  StageExecution,
  GateRule,
  ClaudeStreamEvent,
} from "../lib/types";

export function useStageExecution() {
  const activeProject = useProjectStore((s) => s.activeProject);
  const { stageTemplates, executions, loadExecutions, updateTask } =
    useTaskStore();
  const { appendOutput, clearOutput, setRunning, setStopped } =
    useProcessStore();

  const runStage = useCallback(
    async (task: Task, stage: StageTemplate, userInput?: string) => {
      if (!activeProject) return;

      clearOutput(stage.id);
      setRunning(stage.id, "spawning");

      try {
        // Find previous completed execution
        const prevExec = await repo.getPreviousStageExecution(
          activeProject.id,
          task.id,
          stage.sort_order,
          stageTemplates,
        );

        // Use the previous stage's composed result as input context
        const previousOutput =
          prevExec?.stage_result ??
          prevExec?.parsed_output ??
          prevExec?.raw_output ??
          undefined;

        // Count previous attempts and gather prior context for re-runs
        const prevAttempts = executions
          .filter((e) => e.stage_template_id === stage.id)
          .sort((a, b) => a.attempt_number - b.attempt_number);
        const attemptNumber = prevAttempts.length + 1;

        // For re-runs: include prior attempt output so the agent knows what
        // it already researched/asked, and preserve the original user input
        let priorAttemptOutput: string | undefined;
        let effectiveUserInput = userInput;
        if (prevAttempts.length > 0) {
          const latestAttempt = prevAttempts[prevAttempts.length - 1];
          priorAttemptOutput =
            latestAttempt.parsed_output ?? latestAttempt.raw_output ?? undefined;

          // Preserve original user input from the first attempt
          const firstAttempt = prevAttempts[0];
          if (firstAttempt.user_input && userInput) {
            effectiveUserInput = `${firstAttempt.user_input}\n\n---\n\nAnswers to follow-up questions:\n${userInput}`;
          }
        }

        // Render prompt
        const prompt = renderPrompt(stage.prompt_template, {
          taskDescription: task.title,
          previousOutput,
          userInput: effectiveUserInput,
          userDecision: prevExec?.user_decision ?? undefined,
          priorAttemptOutput,
        });

        // Always use a fresh session — context is passed via the prompt template
        const sessionId = crypto.randomUUID();

        // Create execution record
        const executionId = crypto.randomUUID();
        const execution: Omit<StageExecution, "completed_at"> = {
          id: executionId,
          task_id: task.id,
          stage_template_id: stage.id,
          attempt_number: attemptNumber,
          status: "running",
          input_prompt: prompt,
          user_input:
            userInput ??
            (stage.input_source === "previous_stage"
              ? (previousOutput ?? null)
              : null),
          raw_output: null,
          parsed_output: null,
          user_decision: null,
          session_id: sessionId,
          error_message: null,
          thinking_output: null,
          stage_result: null,
          started_at: new Date().toISOString(),
        };

        await repo.createStageExecution(activeProject.id, execution);
        await updateTask(activeProject.id, task.id, { status: "in_progress" });

        // Build allowed tools
        let allowedTools: string[] | undefined;
        if (stage.allowed_tools) {
          try {
            allowedTools = JSON.parse(stage.allowed_tools);
          } catch {
            // ignore
          }
        }

        // Collect output
        let rawOutput = "";
        let resultText = "";
        let thinkingText = "";

        const onEvent = (event: ClaudeStreamEvent) => {
          switch (event.type) {
            case "started":
              setRunning(stage.id, event.process_id);
              appendOutput(stage.id, `[Process started: ${event.process_id}]`);
              // Refresh executions so the UI transitions to show the live stream
              loadExecutions(activeProject!.id, task.id);
              break;
            case "stdout_line":
              rawOutput += event.line + "\n";
              // Try to parse stream-json events
              try {
                const parsed = JSON.parse(event.line);
                if (parsed.type === "assistant" && parsed.message?.content) {
                  for (const block of parsed.message.content) {
                    if (block.type === "text") {
                      appendOutput(stage.id, block.text);
                      resultText += block.text;
                      thinkingText += block.text;
                    }
                  }
                } else if (parsed.type === "result") {
                  // With --json-schema, the output is in structured_output, not result
                  const output = parsed.structured_output ?? parsed.result;
                  if (output != null && output !== "") {
                    const text =
                      typeof output === "string"
                        ? output
                        : JSON.stringify(output);
                    resultText = text;
                    appendOutput(stage.id, text);
                  }
                  // Don't add result to thinkingText — it's the final structured output
                } else if (parsed.type === "content_block_delta") {
                  if (parsed.delta?.text) {
                    appendOutput(stage.id, parsed.delta.text);
                    resultText += parsed.delta.text;
                    thinkingText += parsed.delta.text;
                  }
                }
              } catch {
                // Not JSON, just append as-is
                appendOutput(stage.id, event.line);
              }
              break;
            case "stderr_line":
              appendOutput(stage.id, `[stderr] ${event.line}`);
              break;
            case "completed":
              setStopped(stage.id);
              appendOutput(
                stage.id,
                `[Process completed with exit code: ${event.exit_code}]`,
              );
              // Update execution in DB
              finalizeExecution(
                executionId,
                stage,
                rawOutput,
                resultText,
                event.exit_code,
                thinkingText,
              );
              break;
            case "error":
              setStopped(stage.id);
              appendOutput(stage.id, `[Error] ${event.message}`);
              repo.updateStageExecution(activeProject!.id, executionId, {
                status: "failed",
                error_message: event.message,
                completed_at: new Date().toISOString(),
              }).then(() => loadExecutions(activeProject!.id, task.id));
              break;
          }
        };

        await spawnClaude(
          {
            prompt,
            workingDirectory: activeProject.path,
            sessionId,
            stageExecutionId: executionId,
            appendSystemPrompt: stage.persona_system_prompt ?? undefined,
            outputFormat: "stream-json",
            allowedTools: allowedTools,
            jsonSchema:
              stage.output_format !== "text" && stage.output_schema
                ? stage.output_schema
                : undefined,
          },
          onEvent,
        );
      } catch (err) {
        setStopped(stage.id);
        appendOutput(stage.id, `[Failed] ${err}`);
        await loadExecutions(activeProject.id, task.id).catch(() => {});
      }
    },
    [
      activeProject,
      stageTemplates,
      executions,
      clearOutput,
      appendOutput,
      setRunning,
      setStopped,
      updateTask,
      loadExecutions,
    ],
  );

  const finalizeExecution = useCallback(
    async (
      executionId: string,
      stage: StageTemplate,
      rawOutput: string,
      resultText: string,
      exitCode: number | null,
      thinkingText?: string,
    ) => {
      if (!activeProject) return;
      const task = useTaskStore.getState().activeTask;
      if (!task) return;

      const wasKilled = useProcessStore.getState().stages[stage.id]?.killed ?? false;

      const savedThinking = thinkingText?.trim() || null;

      if (wasKilled || (exitCode !== 0 && exitCode !== null)) {
        await repo.updateStageExecution(activeProject.id, executionId, {
          status: "failed",
          raw_output: rawOutput,
          parsed_output: resultText,
          thinking_output: savedThinking,
          error_message: wasKilled ? "Stopped by user" : `Process exited with code ${exitCode}`,
          completed_at: new Date().toISOString(),
        });
      } else {
        // Try to parse structured output
        let parsedOutput = resultText;
        if (stage.output_format !== "text") {
          parsedOutput = extractJson(resultText) ?? extractJson(rawOutput) ?? resultText;
        }

        await repo.updateStageExecution(activeProject.id, executionId, {
          status: "awaiting_user",
          raw_output: rawOutput,
          parsed_output: parsedOutput,
          thinking_output: savedThinking,
          completed_at: new Date().toISOString(),
        });
      }

      await loadExecutions(activeProject.id, task.id);
    },
    [activeProject, loadExecutions],
  );

  const approveStage = useCallback(
    async (task: Task, stage: StageTemplate, decision?: string) => {
      if (!activeProject) return;

      // Find latest execution for this stage
      const latest = await repo.getLatestExecution(
        activeProject.id,
        task.id,
        stage.id,
      );
      if (!latest) return;

      // Validate gate rules
      const gateRule: GateRule = JSON.parse(stage.gate_rules);
      if (!validateGate(gateRule, decision, latest)) {
        return;
      }

      // Get the previous stage's result (for append/passthrough)
      const prevExec = await repo.getPreviousStageExecution(
        activeProject.id,
        task.id,
        stage.sort_order,
        stageTemplates,
      );
      const prevResult = prevExec?.stage_result ?? null;

      // Extract this stage's own contribution
      const ownOutput = extractStageOutput(stage, latest, decision);

      // Compose stage_result based on result_mode
      const resultMode = stage.result_mode ?? "replace";
      let stageResult: string;
      switch (resultMode) {
        case "append":
          stageResult = prevResult
            ? `${prevResult}\n\n---\n\n${ownOutput}`
            : ownOutput;
          break;
        case "passthrough":
          stageResult = prevResult ?? ownOutput;
          break;
        case "replace":
        default:
          stageResult = ownOutput;
          break;
      }

      // Update execution with decision and computed stage_result
      await repo.updateStageExecution(activeProject.id, latest.id, {
        status: "approved",
        user_decision: decision ?? null,
        stage_result: stageResult,
      });

      // Advance to next stage
      const nextStage = stageTemplates.find(
        (s) => s.sort_order === stage.sort_order + 1,
      );

      if (nextStage) {
        await updateTask(activeProject.id, task.id, {
          current_stage_id: nextStage.id,
        });
      } else {
        await updateTask(activeProject.id, task.id, {
          status: "completed",
        });
      }

      await loadExecutions(activeProject.id, task.id);
    },
    [activeProject, stageTemplates, updateTask, loadExecutions],
  );

  const redoStage = useCallback(
    async (task: Task, stage: StageTemplate, feedback?: string) => {
      if (!activeProject) return;
      await runStage(task, stage, feedback);
    },
    [activeProject, runStage],
  );

  const killCurrent = useCallback(async (stageId: string) => {
    const processId = useProcessStore.getState().stages[stageId]?.processId;
    if (!processId) return;
    // Mark as killed before sending the signal so finalizeExecution knows
    useProcessStore.getState().markKilled(stageId);
    try {
      await killProcess(processId);
    } catch {
      // Process may have already exited
    }
  }, []);

  return { runStage, approveStage, redoStage, killCurrent };
}

/** Try to find and validate a JSON object in a string. Searches raw stdout lines too. */
function extractJson(text: string): string | null {
  if (!text) return null;

  // First try: parse the whole thing
  try {
    JSON.parse(text);
    return text;
  } catch {
    // continue
  }

  // Second try: find JSON in stream-json result lines
  // With --json-schema, output is in structured_output; otherwise in result
  for (const line of text.split("\n")) {
    try {
      const event = JSON.parse(line);
      if (event.type === "result") {
        const output = event.structured_output ?? event.result;
        if (output != null && output !== "") {
          const str =
            typeof output === "string" ? output : JSON.stringify(output);
          const parsed = JSON.parse(str);
          if (typeof parsed === "object" && parsed !== null) {
            return str;
          }
        }
      }
    } catch {
      // continue
    }
  }

  // Third try: find the outermost { ... } in the text
  const match = text.match(/\{[\s\S]*\}/);
  if (match) {
    try {
      JSON.parse(match[0]);
      return match[0];
    } catch {
      // continue
    }
  }

  return null;
}

/** Extract a clean, human-readable output from a stage for its stage_result. */
function extractStageOutput(
  stage: StageTemplate,
  execution: StageExecution,
  decision?: string,
): string {
  const raw = execution.parsed_output ?? execution.raw_output ?? "";

  switch (stage.output_format) {
    case "research": {
      // Extract the markdown research text from the JSON envelope
      try {
        const data = JSON.parse(raw);
        if (data.research) return data.research;
      } catch {
        // fall through
      }
      return raw;
    }
    case "options": {
      // The stage's value is the user's selection, not the full options list
      if (decision) return formatSelectedApproach(decision);
      return raw;
    }
    default:
      return raw;
  }
}

function formatSelectedApproach(decision: string): string {
  try {
    const selected = JSON.parse(decision);
    if (!Array.isArray(selected) || selected.length === 0) return decision;
    const approach = selected[0];
    let text = `## Selected Approach: ${approach.title}\n\n${approach.description}`;
    if (approach.pros?.length) {
      text += `\n\n**Pros:**\n${approach.pros.map((p: string) => `- ${p}`).join("\n")}`;
    }
    if (approach.cons?.length) {
      text += `\n\n**Cons:**\n${approach.cons.map((c: string) => `- ${c}`).join("\n")}`;
    }
    return text;
  } catch {
    return decision;
  }
}

function validateGate(
  rule: GateRule,
  decision: string | undefined,
  _execution: StageExecution,
): boolean {
  switch (rule.type) {
    case "require_approval":
      return true;
    case "require_selection": {
      if (!decision) return false;
      try {
        const selected = JSON.parse(decision);
        if (!Array.isArray(selected)) return false;
        return (
          selected.length >= rule.min && selected.length <= rule.max
        );
      } catch {
        return true; // Treat non-array as single selection
      }
    }
    case "require_all_checked": {
      if (!decision) return false;
      try {
        const items = JSON.parse(decision);
        return (
          Array.isArray(items) && items.every((item: { checked: boolean }) => item.checked)
        );
      } catch {
        return false;
      }
    }
    case "require_fields": {
      if (!decision) return false;
      try {
        const fields = JSON.parse(decision);
        return rule.fields.every(
          (f) => fields[f] && String(fields[f]).trim().length > 0,
        );
      } catch {
        return false;
      }
    }
    default:
      return true;
  }
}
