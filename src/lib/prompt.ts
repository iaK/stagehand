interface PromptContext {
  taskDescription: string;
  previousOutput?: string;
  userInput?: string;
  userDecision?: string;
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

  // Handle {{#if variable}} ... {{/if}} blocks
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
              : undefined;
      return value ? content : "";
    },
  );

  return result.trim();
}
