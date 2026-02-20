interface PromptContext {
  taskDescription: string;
  userInput?: string;
  userDecision?: string;
  priorAttemptOutput?: string;
  availableStages?: string;
}

export function renderPrompt(
  template: string,
  context: PromptContext,
): string {
  let result = template;

  result = result.replace(/\{\{task_description\}\}/g, context.taskDescription);
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
    /\{\{available_stages\}\}/g,
    context.availableStages ?? "",
  );

  // Handle {{#if variable}} ... {{else}} ... {{/if}} blocks
  result = result.replace(
    /\{\{#if\s+([\w.]+)\}\}([\s\S]*?)\{\{\/if\}\}/g,
    (_match, varName: string, content: string) => {
      let value: string | undefined;

      if (varName === "user_input") {
        value = context.userInput;
      } else if (varName === "user_decision") {
        value = context.userDecision;
      } else if (varName === "prior_attempt_output") {
        value = context.priorAttemptOutput;
      } else if (varName === "available_stages") {
        value = context.availableStages;
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

  // Strip any unresolved {{variable}} placeholders (e.g. from old templates
  // that still reference removed variables like {{previous_output}}).
  // Only strip simple variable refs, not control flow tags (#if, else, /if).
  result = result.replace(/\{\{(?!#|\/|else\}\})([\w.]+)\}\}/g, "");

  return result.trim();
}
