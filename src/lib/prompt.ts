interface PromptContext {
  taskDescription: string;
  previousOutput?: string;
  userInput?: string;
  userDecision?: string;
  priorAttemptOutput?: string;
  stageSummaries?: string;
  stageOutputs?: Record<string, { output: string; summary: string }>;
  allStageOutputs?: string;
  availableStages?: string;
}

export function renderPrompt(
  template: string,
  context: PromptContext,
): string {
  let result = template;

  result = result.replace(/\{\{task_description\}\}/g, context.taskDescription);
  result = result.replace(
    /\{\{previous_output\}\}/g,
    context.previousOutput ?? "(no previous output)",
  );
  result = result.replace(
    /\{\{user_input\}\}/g,
    context.userInput ?? "",
  );
  result = result.replace(
    /\{\{user_decision\}\}/g,
    context.userDecision ?? "",
  );
  result = result.replace(
    /\{\{prior_attempt_output\}\}/g,
    context.priorAttemptOutput ?? "",
  );
  result = result.replace(
    /\{\{stage_summaries\}\}/g,
    context.stageSummaries ?? "",
  );
  result = result.replace(
    /\{\{all_stage_outputs\}\}/g,
    context.allStageOutputs ?? "",
  );
  result = result.replace(
    /\{\{available_stages\}\}/g,
    context.availableStages ?? "",
  );

  // Handle {{stages.StageName.output}} and {{stages.StageName.summary}}
  result = result.replace(
    /\{\{stages\.([^.}]+)\.(output|summary)\}\}/g,
    (_match, stageName: string, field: "output" | "summary") => {
      const data = context.stageOutputs?.[stageName];
      if (!data) return "";
      return field === "output" ? data.output : data.summary;
    },
  );

  // Handle {{#if variable}} ... {{else}} ... {{/if}} blocks
  // Support both simple variables and dotted paths like stages.X.output
  result = result.replace(
    /\{\{#if\s+([\w.]+)\}\}([\s\S]*?)\{\{\/if\}\}/g,
    (_match, varName: string, content: string) => {
      let value: string | undefined;

      // Check for stages.StageName.output / stages.StageName.summary
      const stageMatch = varName.match(/^stages\.([^.]+)\.(output|summary)$/);
      if (stageMatch) {
        const data = context.stageOutputs?.[stageMatch[1]];
        value = data ? (stageMatch[2] === "output" ? data.output : data.summary) : undefined;
      } else {
        value =
          varName === "user_input"
            ? context.userInput
            : varName === "previous_output"
              ? context.previousOutput
              : varName === "user_decision"
                ? context.userDecision
                : varName === "prior_attempt_output"
                  ? context.priorAttemptOutput
                  : varName === "stage_summaries"
                    ? context.stageSummaries
                    : varName === "all_stage_outputs"
                      ? context.allStageOutputs
                      : varName === "available_stages"
                        ? context.availableStages
                        : undefined;
      }

      // Split on {{else}} — first part for truthy, second for falsy
      const parts = content.split(/\{\{else\}\}/);
      if (value) {
        return parts[0];
      } else {
        return parts.length > 1 ? parts[1] : "";
      }
    },
  );

  return result.trim();
}
