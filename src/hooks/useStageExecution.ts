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

      clearOutput();
      setRunning("spawning");

      // Find previous completed execution
      const prevExec = await repo.getPreviousStageExecution(
        activeProject.id,
        task.id,
        stage.sort_order,
        stageTemplates,
      );

      // Render prompt
      const prompt = renderPrompt(stage.prompt_template, {
        taskDescription: task.title,
        previousOutput: prevExec?.parsed_output ?? prevExec?.raw_output ?? undefined,
        userInput,
        userDecision: prevExec?.user_decision ?? undefined,
      });

      // Count previous attempts
      const prevAttempts = executions.filter(
        (e) => e.stage_template_id === stage.id,
      );
      const attemptNumber = prevAttempts.length + 1;

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
        user_input: userInput ?? null,
        raw_output: null,
        parsed_output: null,
        user_decision: null,
        session_id: sessionId,
        error_message: null,
        thinking_output: null,
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
            setRunning(event.process_id);
            appendOutput(`[Process started: ${event.process_id}]`);
            break;
          case "stdout_line":
            rawOutput += event.line + "\n";
            // Try to parse stream-json events
            try {
              const parsed = JSON.parse(event.line);
              if (parsed.type === "assistant" && parsed.message?.content) {
                for (const block of parsed.message.content) {
                  if (block.type === "text") {
                    appendOutput(block.text);
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
                  appendOutput(text);
                }
                // Don't add result to thinkingText — it's the final structured output
              } else if (parsed.type === "content_block_delta") {
                if (parsed.delta?.text) {
                  appendOutput(parsed.delta.text);
                  resultText += parsed.delta.text;
                  thinkingText += parsed.delta.text;
                }
              }
            } catch {
              // Not JSON, just append as-is
              appendOutput(event.line);
            }
            break;
          case "stderr_line":
            appendOutput(`[stderr] ${event.line}`);
            break;
          case "completed":
            setStopped();
            appendOutput(
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
            setStopped();
            appendOutput(`[Error] ${event.message}`);
            repo.updateStageExecution(activeProject!.id, executionId, {
              status: "failed",
              error_message: event.message,
              completed_at: new Date().toISOString(),
            }).then(() => loadExecutions(activeProject!.id, task.id));
            break;
        }
      };

      try {
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
        setStopped();
        appendOutput(`[Failed to spawn] ${err}`);
        await repo.updateStageExecution(activeProject.id, executionId, {
          status: "failed",
          error_message: String(err),
          completed_at: new Date().toISOString(),
        });
        await loadExecutions(activeProject.id, task.id);
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

      const wasKilled = useProcessStore.getState().killed;

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

      // For research format, extract clean markdown for downstream stages
      let parsedOutputOverride: string | undefined;
      if (stage.output_format === "research" && latest.parsed_output) {
        try {
          const researchData = JSON.parse(latest.parsed_output);
          if (researchData.research) {
            parsedOutputOverride = researchData.research;
          }
        } catch {
          // keep existing parsed_output
        }
      }

      // Update execution
      await repo.updateStageExecution(activeProject.id, latest.id, {
        status: "approved",
        user_decision: decision ?? null,
        ...(parsedOutputOverride !== undefined && { parsed_output: parsedOutputOverride }),
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

  const killCurrent = useCallback(async () => {
    const processId = useProcessStore.getState().currentProcessId;
    if (!processId) return;
    // Mark as killed before sending the signal so finalizeExecution knows
    useProcessStore.getState().markKilled();
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
