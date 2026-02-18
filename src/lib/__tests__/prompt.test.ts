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

  it("substitutes {{stages.StageName.output}}", () => {
    const result = renderPrompt(
      "Research: {{stages.Research.output}}",
      {
        taskDescription: "task",
        stageOutputs: {
          Research: { output: "Found the bug in auth.", summary: "Auth bug found." },
        },
      },
    );
    expect(result).toBe("Research: Found the bug in auth.");
  });

  it("substitutes {{stages.StageName.summary}}", () => {
    const result = renderPrompt(
      "Summary: {{stages.Research.summary}}",
      {
        taskDescription: "task",
        stageOutputs: {
          Research: { output: "Full output", summary: "Short summary" },
        },
      },
    );
    expect(result).toBe("Summary: Short summary");
  });

  it("handles {{#if stages.X.output}} conditional", () => {
    const withData = renderPrompt(
      "{{#if stages.Research.output}}Has research: {{stages.Research.output}}{{else}}No research{{/if}}",
      {
        taskDescription: "task",
        stageOutputs: {
          Research: { output: "Found bug", summary: "" },
        },
      },
    );
    expect(withData).toBe("Has research: Found bug");

    const withoutData = renderPrompt(
      "{{#if stages.Research.output}}Has research{{else}}No research{{/if}}",
      { taskDescription: "task" },
    );
    expect(withoutData).toBe("No research");
  });

  it("returns empty for missing stage in {{stages.X.output}}", () => {
    const result = renderPrompt(
      "Output: {{stages.Missing.output}}",
      { taskDescription: "task" },
    );
    expect(result).toBe("Output:");
  });

  it("substitutes {{all_stage_outputs}}", () => {
    const result = renderPrompt(
      "All: {{all_stage_outputs}}",
      {
        taskDescription: "task",
        allStageOutputs: "## Research\nBug found\n\n---\n\n## Planning\nStep 1",
      },
    );
    expect(result).toContain("## Research");
    expect(result).toContain("## Planning");
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
});
