// Canonical prompt templates and JSON schemas for stage templates.
// seed.ts uses these for new projects; migrations use db/prompts.ts
// (which has the older {{previous_output}} variants for migration guards).

// === JSON Schemas (shared between seed.ts and migrations) ===

export const RESEARCH_SCHEMA = JSON.stringify({
  type: "object",
  properties: {
    research: { type: "string" },
    questions: {
      type: "array",
      items: {
        type: "object",
        properties: {
          id: { type: "string" },
          question: { type: "string" },
          proposed_answer: { type: "string" },
          options: {
            type: "array",
            items: { type: "string" },
          },
        },
        required: ["id", "question", "proposed_answer"],
      },
    },
    suggested_stages: {
      type: "array",
      items: {
        type: "object",
        properties: {
          name: { type: "string" },
          reason: { type: "string" },
        },
        required: ["name", "reason"],
      },
    },
  },
  required: ["research", "questions", "suggested_stages"],
});

export const FINDINGS_SCHEMA = JSON.stringify({
  type: "object",
  properties: {
    summary: { type: "string" },
    findings: {
      type: "array",
      items: {
        type: "object",
        properties: {
          id: { type: "string" },
          title: { type: "string" },
          description: { type: "string" },
          severity: {
            type: "string",
            enum: ["critical", "warning", "info"],
          },
          category: { type: "string" },
          file_path: { type: "string" },
          selected: { type: "boolean" },
        },
        required: ["id", "title", "description", "severity", "selected"],
      },
    },
  },
  required: ["summary", "findings"],
});

export const APPROACHES_SCHEMA = JSON.stringify({
  type: "object",
  properties: {
    options: {
      type: "array",
      items: {
        type: "object",
        properties: {
          id: { type: "string" },
          title: { type: "string" },
          description: { type: "string" },
          pros: { type: "array", items: { type: "string" } },
          cons: { type: "array", items: { type: "string" } },
        },
        required: ["id", "title", "description", "pros", "cons"],
      },
    },
    questions: {
      type: "array",
      items: {
        type: "object",
        properties: {
          id: { type: "string" },
          question: { type: "string" },
          proposed_answer: { type: "string" },
          options: {
            type: "array",
            items: { type: "string" },
          },
        },
        required: ["id", "question", "proposed_answer"],
      },
    },
  },
  required: ["options", "questions"],
});

export const PLANNING_SCHEMA = JSON.stringify({
  type: "object",
  properties: {
    plan: { type: "string" },
    questions: {
      type: "array",
      items: {
        type: "object",
        properties: {
          id: { type: "string" },
          question: { type: "string" },
          proposed_answer: { type: "string" },
          options: {
            type: "array",
            items: { type: "string" },
          },
        },
        required: ["id", "question", "proposed_answer"],
      },
    },
  },
  required: ["plan", "questions"],
});

export const PR_PREPARATION_SCHEMA = JSON.stringify({
  type: "object",
  properties: {
    fields: {
      type: "object",
      properties: {
        title: { type: "string" },
        description: { type: "string" },
        test_plan: { type: "string" },
      },
      required: ["title", "description", "test_plan"],
    },
  },
  required: ["fields"],
});

// === MCP-based Prompt Templates (canonical for new projects) ===

export const RESEARCH_PROMPT = `You are a senior software engineer performing research on a task. Your ONLY job is to investigate and understand — do NOT plan, propose solutions, or discuss implementation approaches.

Task: {{task_description}}

{{#if user_input}}
Additional context / answers from the developer:
{{user_input}}
{{/if}}

{{#if prior_attempt_output}}
Your previous research output (build on this, do NOT repeat questions that have already been answered):
{{prior_attempt_output}}
{{/if}}

Investigate the codebase and provide a factual analysis:
1. **Problem understanding** — What exactly needs to happen? What is the current behavior vs desired behavior?
2. **Relevant code** — Which files, functions, components, and patterns are involved? Quote key code snippets.
3. **Dependencies & constraints** — What does this code depend on? What depends on it? Are there tests, types, or contracts to respect?
4. **Codebase conventions** — What patterns, naming conventions, and architectural decisions does the project follow that are relevant?

Do NOT:
- Suggest how to implement the solution
- Propose architectural approaches
- Discuss trade-offs between implementation options
- Make recommendations about what approach to take

Your questions should ONLY be about clarifying requirements and scope — what the developer wants, not how to build it.

If you have questions, include them in the "questions" array. For each question:
- Provide a "proposed_answer" with your best guess
- Provide an "options" array with 2-4 selectable choices the developer can pick from (the developer can also write a custom answer)
- Do NOT re-ask questions the developer has already answered above

If all questions have been answered and the research is complete, return an empty "questions" array.

Additionally, suggest which pipeline stages this task needs. The available stages are:
{{available_stages}}

For simple bug fixes, you might only need Implementation. For large features, you might need all stages.
Include your suggestions in the "suggested_stages" array.

Respond with a JSON object matching the output schema.`;

export const APPROACHES_PROMPT = `You are a senior software architect proposing implementation approaches for a task.

Task: {{task_description}}

Review the completed stages in your system prompt for research findings. Use the get_stage_output MCP tool if you need the full research output.

{{#if user_input}}
Developer's answers to your questions:
{{user_input}}
{{/if}}

{{#if prior_attempt_output}}
Your previous output (incorporate the developer's answers above and refine your thinking):
{{prior_attempt_output}}
{{/if}}

Before proposing approaches, you may ask the developer clarifying questions about implementation preferences, trade-offs they care about, or constraints that affect the approach. These should be questions about HOW to build it (not WHAT to build — that was covered in research).

If you need more information, include questions in the "questions" array and leave "options" empty.
If you have enough information, provide 2-4 distinct approaches in "options" with an empty "questions" array.

For each question:
- Provide a "proposed_answer" with your best guess
- Provide an "options" array with 2-4 selectable choices
- Do NOT re-ask questions the developer has already answered above

For each approach, provide:
- A clear title
- Description of the approach
- Pros (advantages)
- Cons (disadvantages)

Respond with a JSON object matching the output schema.`;

export const PLANNING_PROMPT = `You are a senior software engineer creating a detailed implementation plan.

Task: {{task_description}}

{{#if user_decision}}
Selected approach:
{{user_decision}}
{{/if}}

Review the completed stages in your system prompt for research findings and context. Use the get_stage_output MCP tool if you need full details from any prior stage.

{{#if user_input}}
Developer's answers to your questions:
{{user_input}}
{{/if}}

{{#if prior_attempt_output}}
Your previous output (incorporate the developer's answers above and refine your plan):
{{prior_attempt_output}}
{{/if}}

Before writing the plan, you may ask the developer clarifying questions about implementation details — e.g. naming preferences, testing expectations, specific behaviors for edge cases, or anything that would change the plan.

If you need more information, include questions in the "questions" array and set "plan" to a brief summary of what you know so far.
If you have enough information, provide the full plan in "plan" with an empty "questions" array.

For each question:
- Provide a "proposed_answer" with your best guess
- Provide an "options" array with 2-4 selectable choices
- Do NOT re-ask questions the developer has already answered above

The plan should include:
1. Step-by-step implementation plan
2. Files that need to be created or modified
3. Dependencies or prerequisites
4. Testing strategy
5. Potential edge cases to handle

Respond with a JSON object matching the output schema.`;

export const IMPLEMENTATION_PROMPT = `Implement the task below. Review the completed stages in your system prompt for the implementation plan and research context. Use the get_stage_output MCP tool to retrieve the full plan.

Task: {{task_description}}

Follow the plan carefully. Write clean, well-structured code. Run tests if applicable.`;

export const REFINEMENT_FINDINGS_PROMPT = `{{#if prior_attempt_output}}You are applying selected refinements to an implementation.

Task that was implemented:
{{task_description}}

Review the completed stages in your system prompt for context. Use the get_stage_output MCP tool to retrieve full implementation details if needed.

## Selected Findings to Apply

The developer selected these findings to fix:
{{prior_attempt_output}}

Apply ONLY these specific fixes. Do not make other changes. For each finding, make the necessary code changes.

Provide a summary of what you changed.
{{else}}You are performing a critical self-review of an implementation that was just completed. Act as a thorough code reviewer who questions the work before it ships.

Task that was implemented:
{{task_description}}

Review the completed stages in your system prompt for context. Use the get_stage_output MCP tool to retrieve full implementation details.

## Review Checklist

Critically examine the implementation against each of these:

1. **Completeness** — Does the implementation fully address the task? Are there overlooked edge cases, missing error handling, or incomplete features?
2. **Correctness** — Does the logic actually work for all expected inputs? Any bugs, race conditions, off-by-one errors, or type mismatches?
3. **Codebase Consistency** — Does the new code follow the same patterns, conventions, and style as the existing codebase? Are similar things done in similar ways?
4. **Cleanup** — Any leftover debug code, unused imports, commented-out code, or inconsistent naming?
5. **Simplicity** — Is anything over-engineered or unnecessarily complex? Could it be simplified without losing functionality?

Be nitpicky. Flag everything you notice, even minor issues — the developer will choose which to fix.

Do NOT make any code changes. Only identify and report findings.

Respond with a JSON object matching the output schema.{{/if}}`;

export const SECURITY_FINDINGS_PROMPT = `{{#if prior_attempt_output}}You are applying selected security fixes to an implementation.

Task: {{task_description}}

Review the completed stages in your system prompt for context. Use the get_stage_output MCP tool to retrieve full implementation details if needed.

## Selected Security Findings to Fix

The developer selected these security findings to address:
{{prior_attempt_output}}

Apply ONLY these specific security fixes. Do not make other changes. For each finding, make the necessary code changes to resolve the security issue.

Provide a summary of what you changed.
{{else}}Perform a thorough security review of the changes made for this task.

Task: {{task_description}}

Review the completed stages in your system prompt for context. Use the get_stage_output MCP tool to retrieve full implementation details.

Check for:
1. Input validation issues
2. Authentication/authorization flaws
3. Injection vulnerabilities (SQL, XSS, command injection)
4. Data exposure risks
5. Dependency vulnerabilities
6. Configuration security
7. Error handling that might leak information

Be thorough. Flag everything you notice, even minor concerns — the developer will choose which to fix.

Do NOT make any code changes. Only identify and report findings.

Respond with a JSON object matching the output schema.{{/if}}`;

export const DOCUMENTATION_PROMPT = `You are a senior technical writer documenting changes made during a development task.

Task: {{task_description}}

Review the completed stages in your system prompt for a summary of all work done. Use the get_stage_output MCP tool to retrieve full details from any stage you need.

{{#if user_input}}
Developer instructions:
{{user_input}}
{{/if}}

Your job:
1. **Read existing documentation** at the target path (if provided) to understand the current style, structure, and conventions.
2. **Synthesize** the work done across all completed stages into clear, accurate documentation.
3. **Write documentation files** using the Write tool. Match the existing documentation style if updating existing docs, or follow standard conventions for new docs.

Focus on:
- What changed and why
- How to use any new features or APIs
- Updated configuration or setup instructions if applicable
- Code examples where helpful

Keep the documentation concise and developer-focused. Do not include implementation details that aren't relevant to users of the code.`;

export const TASK_SPLITTING_SCHEMA = JSON.stringify({
  type: "object",
  properties: {
    reasoning: {
      type: "string",
      description: "Explanation of why this task should be split and how the subtasks relate to the whole.",
    },
    proposed_tasks: {
      type: "array",
      items: {
        type: "object",
        properties: {
          id: { type: "string" },
          title: { type: "string", description: "Actionable title starting with a verb" },
          description: { type: "string", description: "Enough context to work on independently" },
          selected: { type: "boolean", description: "true for recommended subtasks, false for optional" },
        },
        required: ["id", "title", "description", "selected"],
      },
    },
  },
  required: ["reasoning", "proposed_tasks"],
});

export const TASK_SPLITTING_PROMPT = `You are a senior software engineer analyzing a task to decompose it into smaller, independent subtasks.

Task: {{task_description}}

Review the completed stages for research findings. Use the get_stage_output MCP tool to retrieve the full research output if needed.

Based on the research, decompose this task into smaller, independently-completable subtasks. Each subtask should:
- Be self-contained and independently implementable
- Have a clear, specific title (actionable, starts with a verb)
- Have a description that provides enough context to work on it independently
- Not depend on other subtasks being completed first (when possible)
- Each subtask will get its own git branch and full pipeline

Set "selected": true for subtasks you recommend. Set "selected": false for optional or lower-priority subtasks.

Your "reasoning" should explain WHY this task benefits from splitting and how the subtasks relate to the whole.

Respond with a JSON object matching the required schema.`;

export const SECOND_OPINION_PROMPT = `{{#if prior_attempt_output}}You are revising an implementation plan based on the developer's selected concerns.

Task: {{task_description}}

Review the completed stages in your system prompt for the plan. Use the get_stage_output MCP tool to retrieve the full plan if needed.

## Selected Concerns to Address

The developer selected these concerns to address:

{{prior_attempt_output}}

Revise the plan to address ONLY these specific concerns. Do not make other changes. For each concern, explain what you changed and why.

Output the revised plan as clear markdown.
{{else}}You are an independent reviewer performing a critical analysis of an implementation plan. Your job is to find problems BEFORE implementation begins.

Task: {{task_description}}

Review the completed stages in your system prompt for the plan. Use the get_stage_output MCP tool to retrieve the full plan.

## Review Dimensions

Analyze the plan against each of these:

1. **Completeness** — Does the plan cover all aspects of the task? Are there missing steps, unhandled edge cases, or gaps in the approach?
2. **Correctness** — Will the proposed approach actually work? Are there logical errors, wrong assumptions about APIs/libraries, or misunderstandings of the codebase?
3. **Risk** — What could go wrong? Are there risky changes (data migrations, breaking changes, security implications) that aren't acknowledged?
4. **Simplicity** — Is the plan over-engineered? Could the same goal be achieved with fewer changes or a simpler approach?
5. **Ordering** — Are the steps in the right order? Are there dependency issues where step N requires something from step M that comes later?

Be thorough and skeptical. Flag everything you notice — the developer will choose which concerns to address.

If the plan is solid and you find no issues, return an empty findings array. IMPORTANT: In this case, set the "summary" field to the FULL original plan text verbatim — this is critical because the summary is passed as input to the next stage, so it must contain the complete plan, not just an assessment.

Do NOT modify the plan. Only identify and report concerns.

Respond with a JSON object matching the output schema.{{/if}}`;

export const PR_PREPARATION_PROMPT = `Prepare a pull request for the following completed task.

Task: {{task_description}}

Review the completed stages in your system prompt for a summary of all work done. Use the get_stage_output MCP tool to retrieve full details from any stage you need.

Generate:
1. A concise PR title
2. A detailed description explaining the changes
3. A test plan describing how to verify the changes

Respond with a JSON object matching the output schema.`;
