import type { StageTemplate } from "./types";

export function getDefaultStageTemplates(
  projectId: string,
): Omit<StageTemplate, "created_at" | "updated_at">[] {
  return [
    {
      id: crypto.randomUUID(),
      project_id: projectId,
      name: "Research",
      description:
        "Investigate the problem space, gather context, and understand requirements.",
      sort_order: 0,
      prompt_template: `You are a senior software engineer performing research on a task. Your ONLY job is to investigate and understand — do NOT plan, propose solutions, or discuss implementation approaches.

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

Respond with a JSON object matching this structure:
{
  "research": "Your factual research analysis in Markdown (NO implementation suggestions)...",
  "questions": [
    {
      "id": "q1",
      "question": "Your question here?",
      "proposed_answer": "Your best-guess answer",
      "options": ["Option A", "Option B", "Option C"]
    }
  ],
  "suggested_stages": [
    { "name": "Implementation", "reason": "Code changes are needed" },
    { "name": "PR Preparation", "reason": "Changes should be submitted as a PR" }
  ]
}`,
      input_source: "user",
      output_format: "research",
      output_schema: JSON.stringify({
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
      }),
      gate_rules: JSON.stringify({ type: "require_approval" }),
      persona_name: null,
      persona_system_prompt: null,
      persona_model: null,
      preparation_prompt: null,
      allowed_tools: JSON.stringify(["Read", "Glob", "Grep", "WebSearch", "WebFetch"]),
      requires_user_input: 1,
    },
    {
      id: crypto.randomUUID(),
      project_id: projectId,
      name: "High-Level Approaches",
      description:
        "Generate multiple implementation approaches based on the research.",
      sort_order: 1,
      prompt_template: `You are a senior software architect proposing implementation approaches for a task.

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

Respond with a JSON object matching this structure:
{
  "options": [
    {
      "id": "approach-1",
      "title": "Approach Title",
      "description": "Detailed description",
      "pros": ["pro 1", "pro 2"],
      "cons": ["con 1", "con 2"]
    }
  ],
  "questions": [
    {
      "id": "q1",
      "question": "Your question here?",
      "proposed_answer": "Your best-guess answer",
      "options": ["Option A", "Option B"]
    }
  ]
}`,
      input_source: "previous_stage",
      output_format: "options",
      output_schema: JSON.stringify({
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
      }),
      gate_rules: JSON.stringify({
        type: "require_selection",
        min: 1,
        max: 1,
      }),
      persona_name: null,
      persona_system_prompt: null,
      persona_model: null,
      preparation_prompt: null,
      allowed_tools: JSON.stringify(["Read", "Glob", "Grep"]),
      requires_user_input: 0,
    },
    {
      id: crypto.randomUUID(),
      project_id: projectId,
      name: "Planning",
      description:
        "Create a detailed implementation plan based on the selected approach.",
      sort_order: 2,
      prompt_template: `You are a senior software engineer creating a detailed implementation plan.

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

Respond with a JSON object matching this structure:
{
  "plan": "Your detailed implementation plan in Markdown...",
  "questions": [
    {
      "id": "q1",
      "question": "Your question here?",
      "proposed_answer": "Your best-guess answer",
      "options": ["Option A", "Option B"]
    }
  ]
}`,
      input_source: "previous_stage",
      output_format: "plan",
      output_schema: JSON.stringify({
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
      }),
      gate_rules: JSON.stringify({ type: "require_approval" }),
      persona_name: null,
      persona_system_prompt: null,
      persona_model: null,
      preparation_prompt: null,
      allowed_tools: JSON.stringify(["Read", "Glob", "Grep"]),
      requires_user_input: 0,
    },
    {
      id: crypto.randomUUID(),
      project_id: projectId,
      name: "Implementation",
      description:
        "Execute the implementation plan — write code, create files, run commands.",
      sort_order: 3,
      prompt_template: `Implement the task below. Review the completed stages in your system prompt for the implementation plan and research context. Use the get_stage_output MCP tool to retrieve the full plan.

Task: {{task_description}}

Follow the plan carefully. Write clean, well-structured code. Run tests if applicable.`,
      input_source: "previous_stage",
      output_format: "text",
      output_schema: null,
      gate_rules: JSON.stringify({ type: "require_approval" }),
      persona_name: null,
      persona_system_prompt: null,
      persona_model: null,
      preparation_prompt: null,
      allowed_tools: null, // Full tool access
      requires_user_input: 0,
    },
    {
      id: crypto.randomUUID(),
      project_id: projectId,
      name: "Refinement",
      description:
        "Self-review the implementation: identify issues for the developer to select, then apply chosen fixes.",
      sort_order: 4,
      prompt_template: `{{#if prior_attempt_output}}You are applying selected refinements to an implementation.

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

Respond with a JSON object:
{
  "summary": "Brief overview of what you reviewed and overall assessment",
  "findings": [
    {
      "id": "f1",
      "title": "Short title of the finding",
      "description": "Detailed description of the issue and suggested fix",
      "severity": "critical|warning|info",
      "category": "completeness|correctness|consistency|cleanup|simplicity",
      "file_path": "path/to/file.ts (optional)",
      "selected": true
    }
  ]
}{{/if}}`,
      input_source: "previous_stage",
      output_format: "findings",
      output_schema: JSON.stringify({
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
      }),
      gate_rules: JSON.stringify({ type: "require_approval" }),
      persona_name: null,
      persona_system_prompt: null,
      persona_model: null,
      preparation_prompt: null,
      allowed_tools: null,
      requires_user_input: 0,
    },
    {
      id: crypto.randomUUID(),
      project_id: projectId,
      name: "Security Review",
      description:
        "Analyze for security vulnerabilities, then apply selected fixes.",
      sort_order: 5,
      prompt_template: `{{#if prior_attempt_output}}You are applying selected security fixes to an implementation.

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

Respond with a JSON object:
{
  "summary": "Brief overview of security posture and key concerns",
  "findings": [
    {
      "id": "sec-1",
      "title": "Short title of the security finding",
      "description": "Detailed description of the vulnerability and recommended fix",
      "severity": "critical|warning|info",
      "category": "validation|auth|injection|exposure|deps|config|error-handling",
      "file_path": "path/to/file.ts (optional)",
      "selected": true
    }
  ]
}{{/if}}`,
      input_source: "previous_stage",
      output_format: "findings",
      output_schema: JSON.stringify({
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
      }),
      gate_rules: JSON.stringify({ type: "require_approval" }),
      persona_name: null,
      persona_system_prompt: null,
      persona_model: null,
      preparation_prompt: null,
      allowed_tools: null,
      requires_user_input: 0,
    },
    {
      id: crypto.randomUUID(),
      project_id: projectId,
      name: "Documentation",
      description:
        "Write or update documentation based on the changes made in this task.",
      sort_order: 6,
      prompt_template: `You are a senior technical writer documenting changes made during a development task.

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

Keep the documentation concise and developer-focused. Do not include implementation details that aren't relevant to users of the code.`,
      input_source: "both",
      output_format: "text",
      output_schema: null,
      gate_rules: JSON.stringify({ type: "require_approval" }),
      persona_name: null,
      persona_system_prompt: null,
      persona_model: null,
      preparation_prompt: null,
      allowed_tools: null,
      requires_user_input: 0,
    },
    {
      id: crypto.randomUUID(),
      project_id: projectId,
      name: "PR Preparation",
      description:
        "Generate a pull request title, description, and test plan.",
      sort_order: 7,
      prompt_template: `Prepare a pull request for the following completed task.

Task: {{task_description}}

Review the completed stages in your system prompt for a summary of all work done. Use the get_stage_output MCP tool to retrieve full details from any stage you need.

Generate:
1. A concise PR title
2. A detailed description explaining the changes
3. A test plan describing how to verify the changes

Respond with a JSON object:
{
  "fields": {
    "title": "PR title here",
    "description": "PR description here",
    "test_plan": "Test plan here"
  }
}`,
      input_source: "previous_stage",
      output_format: "pr_preparation",
      output_schema: JSON.stringify({
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
      }),
      gate_rules: JSON.stringify({
        type: "require_fields",
        fields: ["title", "description"],
      }),
      persona_name: null,
      persona_system_prompt: null,
      persona_model: null,
      preparation_prompt: null,
      allowed_tools: JSON.stringify(["Read", "Glob", "Grep"]),
      requires_user_input: 0,
    },
    {
      id: crypto.randomUUID(),
      project_id: projectId,
      name: "PR Review",
      description:
        "Fetch PR reviews from GitHub, fix reviewer comments, and complete the task.",
      sort_order: 8,
      prompt_template: "",
      input_source: "previous_stage",
      output_format: "pr_review",
      output_schema: null,
      gate_rules: JSON.stringify({ type: "require_approval" }),
      persona_name: null,
      persona_system_prompt: null,
      persona_model: null,
      preparation_prompt: null,
      allowed_tools: null,
      requires_user_input: 0,
    },
    {
      id: crypto.randomUUID(),
      project_id: projectId,
      name: "Merge",
      description:
        "Merge the task branch into the target branch and push.",
      sort_order: 9,
      prompt_template: "",
      input_source: "previous_stage",
      output_format: "merge",
      output_schema: null,
      gate_rules: JSON.stringify({ type: "require_approval" }),
      persona_name: null,
      persona_system_prompt: null,
      persona_model: null,
      preparation_prompt: null,
      allowed_tools: null,
      requires_user_input: 0,
    },
  ];
}
