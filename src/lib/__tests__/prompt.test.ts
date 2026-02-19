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
      "Task: {{task_description}}\nInput: {{user_input}}",
      {
        taskDescription: "Build feature",
        userInput: "some input",
      },
    );
    expect(result).toBe(
      "Task: Build feature\nInput: some input",
    );
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

  it("substitutes {{user_decision}}", () => {
    const result = renderPrompt(
      "Decision: {{user_decision}}",
      {
        taskDescription: "task",
        userDecision: "Approach A selected",
      },
    );
    expect(result).toBe("Decision: Approach A selected");
  });

  it("substitutes {{available_stages}}", () => {
    const result = renderPrompt(
      "Stages:\n{{available_stages}}",
      {
        taskDescription: "task",
        availableStages: '- "Implementation": Write code\n- "Refinement": Review code',
      },
    );
    expect(result).toContain("Implementation");
    expect(result).toContain("Refinement");
  });

  it("strips unresolved variable placeholders from old templates", () => {
    const result = renderPrompt(
      "Task: {{task_description}}\n\nPlan:\n{{previous_output}}\n\nSummaries:\n{{stage_summaries}}",
      { taskDescription: "Fix bug" },
    );
    expect(result).toBe("Task: Fix bug\n\nPlan:\n\n\nSummaries:");
  });

  it("handles {{#if user_decision}} conditional", () => {
    const with_ = renderPrompt(
      "{{#if user_decision}}Selected: {{user_decision}}{{else}}No selection{{/if}}",
      { taskDescription: "task", userDecision: "Option B" },
    );
    expect(with_).toBe("Selected: Option B");

    const without = renderPrompt(
      "{{#if user_decision}}Selected{{else}}No selection{{/if}}",
      { taskDescription: "task" },
    );
    expect(without).toBe("No selection");
  });
});
