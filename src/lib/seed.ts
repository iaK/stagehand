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
      prompt_template: `You are a senior software engineer researching a task. Analyze the following task thoroughly.

Task: {{task_description}}

{{#if user_input}}
Additional context / answers from the developer:
{{user_input}}
{{/if}}

{{#if prior_attempt_output}}
Your previous research output (build on this, do NOT repeat questions that have already been answered):
{{prior_attempt_output}}
{{/if}}

Provide a comprehensive analysis including:
1. Understanding of the problem
2. Key technical considerations
3. Relevant existing code/patterns to be aware of
4. Potential challenges and risks

If you have questions that need the developer's input before the research is complete, include them in the "questions" array. For each question:
- Provide a "proposed_answer" with your best guess
- Provide an "options" array with 2-4 selectable choices the developer can pick from (the developer can also write a custom answer)
- Do NOT re-ask questions the developer has already answered above

If all questions have been answered and the research is complete, return an empty "questions" array.

Respond with a JSON object matching this structure:
{
  "research": "Your full research analysis in Markdown...",
  "questions": [
    {
      "id": "q1",
      "question": "Your question here?",
      "proposed_answer": "Your best-guess answer",
      "options": ["Option A", "Option B", "Option C"]
    }
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
        },
        required: ["research", "questions"],
      }),
      gate_rules: JSON.stringify({ type: "require_approval" }),
      persona_name: null,
      persona_system_prompt: null,
      persona_model: null,
      preparation_prompt: null,
      allowed_tools: JSON.stringify(["Read", "Glob", "Grep", "WebSearch", "WebFetch"]),
      result_mode: "replace",
    },
    {
      id: crypto.randomUUID(),
      project_id: projectId,
      name: "High-Level Approaches",
      description:
        "Generate multiple implementation approaches based on the research.",
      sort_order: 1,
      prompt_template: `Based on the research below, propose 2-4 distinct high-level approaches for implementing this task.

Task: {{task_description}}

Research findings:
{{previous_output}}

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
        },
        required: ["options"],
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
      result_mode: "append",
    },
    {
      id: crypto.randomUUID(),
      project_id: projectId,
      name: "Planning",
      description:
        "Create a detailed implementation plan based on the selected approach.",
      sort_order: 2,
      prompt_template: `Create a detailed implementation plan for the following task using the selected approach.

Task: {{task_description}}

Selected approach:
{{user_decision}}

Previous research:
{{previous_output}}

Provide:
1. Step-by-step implementation plan
2. Files that need to be created or modified
3. Dependencies or prerequisites
4. Testing strategy
5. Potential edge cases to handle`,
      input_source: "previous_stage",
      output_format: "text",
      output_schema: null,
      gate_rules: JSON.stringify({ type: "require_approval" }),
      persona_name: null,
      persona_system_prompt: null,
      persona_model: null,
      preparation_prompt: null,
      allowed_tools: JSON.stringify(["Read", "Glob", "Grep"]),
      result_mode: "replace",
    },
    {
      id: crypto.randomUUID(),
      project_id: projectId,
      name: "Implementation",
      description:
        "Execute the implementation plan — write code, create files, run commands.",
      sort_order: 3,
      prompt_template: `Implement the following plan. Write all necessary code, create files, and make changes as specified.

Task: {{task_description}}

Implementation plan:
{{previous_output}}

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
      result_mode: "replace",
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

Implementation output:
{{previous_output}}

## Selected Findings to Apply

The developer selected these findings to fix:
{{prior_attempt_output}}

Apply ONLY these specific fixes. Do not make other changes. For each finding, make the necessary code changes.

Provide a summary of what you changed.
{{else}}You are performing a critical self-review of an implementation that was just completed. Act as a thorough code reviewer who questions the work before it ships.

Task that was implemented:
{{task_description}}

Implementation output:
{{previous_output}}

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
      result_mode: "append",
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

Implementation details:
{{previous_output}}

## Selected Security Findings to Fix

The developer selected these security findings to address:
{{prior_attempt_output}}

Apply ONLY these specific security fixes. Do not make other changes. For each finding, make the necessary code changes to resolve the security issue.

Provide a summary of what you changed.
{{else}}Perform a thorough security review of the changes made for this task.

Task: {{task_description}}

Implementation details:
{{previous_output}}

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
      result_mode: "append",
    },
    {
      id: crypto.randomUUID(),
      project_id: projectId,
      name: "PR Preparation",
      description:
        "Generate a pull request title, description, and test plan.",
      sort_order: 6,
      prompt_template: `Prepare a pull request for the following completed task.

Task: {{task_description}}

Implementation details:
{{previous_output}}

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
      output_format: "structured",
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
      result_mode: "replace",
    },
  ];
}
