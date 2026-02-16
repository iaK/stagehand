interface PromptContext {
  taskDescription: string;
  previousOutput?: string;
  userInput?: string;
  userDecision?: string;
  priorAttemptOutput?: string;
  stageSummaries?: string;
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

  // Handle {{#if variable}} ... {{else}} ... {{/if}} blocks
  result = result.replace(
    /\{\{#if\s+(\w+)\}\}([\s\S]*?)\{\{\/if\}\}/g,
    (_match, varName: string, content: string) => {
      const value =
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
                  : undefined;
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
