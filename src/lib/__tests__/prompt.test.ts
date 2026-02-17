import { renderPrompt } from "../prompt";

describe("renderPrompt", () => {
  it("substitutes {{task_description}}", () => {
    const result = renderPrompt("Task: {{task_description}}", {
      taskDescription: "Fix the login bug",
    });
    expect(result).toBe("Task: Fix the login bug");
  });

  it("substitutes multiple variables", () => {
    const result = renderPrompt(
      "Task: {{task_description}}\nInput: {{user_input}}\nPrev: {{previous_output}}",
      {
        taskDescription: "Build feature",
        userInput: "some input",
        previousOutput: "some output",
      },
    );
    expect(result).toBe(
      "Task: Build feature\nInput: some input\nPrev: some output",
    );
  });

  it("uses default for missing previous_output", () => {
    const result = renderPrompt("Prev: {{previous_output}}", {
      taskDescription: "task",
    });
    expect(result).toBe("Prev: (no previous output)");
  });

  it("uses empty string for missing user_input", () => {
    const result = renderPrompt("Input: {{user_input}}", {
      taskDescription: "task",
    });
    expect(result).toBe("Input:");
  });

  it("handles {{#if}} blocks with truthy value", () => {
    const result = renderPrompt(
      "{{#if user_input}}Has input: {{user_input}}{{/if}}",
      {
        taskDescription: "task",
        userInput: "hello",
      },
    );
    expect(result).toBe("Has input: hello");
  });

  it("handles {{#if}} blocks with falsy value", () => {
    const result = renderPrompt(
      "Start {{#if user_input}}Has input{{/if}} End",
      {
        taskDescription: "task",
      },
    );
    expect(result).toBe("Start  End");
  });

  it("handles {{#if}}...{{else}}...{{/if}} blocks", () => {
    const withInput = renderPrompt(
      "{{#if user_input}}yes{{else}}no{{/if}}",
      { taskDescription: "task", userInput: "val" },
    );
    expect(withInput).toBe("yes");

    const withoutInput = renderPrompt(
      "{{#if user_input}}yes{{else}}no{{/if}}",
      { taskDescription: "task" },
    );
    expect(withoutInput).toBe("no");
  });

  it("handles nested variables inside conditional blocks", () => {
    const result = renderPrompt(
      "{{#if previous_output}}Context: {{previous_output}}{{/if}}",
      {
        taskDescription: "task",
        previousOutput: "prior research",
      },
    );
    expect(result).toBe("Context: prior research");
  });

  it("trims the result", () => {
    const result = renderPrompt("  hello  ", { taskDescription: "t" });
    expect(result).toBe("hello");
  });

  it("passes through template with no variables", () => {
    const result = renderPrompt("Just plain text", {
      taskDescription: "task",
    });
    expect(result).toBe("Just plain text");
  });

  it("handles prior_attempt_output conditional", () => {
    const result = renderPrompt(
      "{{#if prior_attempt_output}}Redo: {{prior_attempt_output}}{{/if}}",
      {
        taskDescription: "task",
        priorAttemptOutput: "previous output here",
      },
    );
    expect(result).toBe("Redo: previous output here");
  });

  it("handles stage_summaries variable", () => {
    const result = renderPrompt(
      "{{#if stage_summaries}}## Summaries\n{{stage_summaries}}{{/if}}",
      {
        taskDescription: "task",
        stageSummaries: "### Research\nFound the bug.",
      },
    );
    expect(result).toBe("## Summaries\n### Research\nFound the bug.");
  });
});
