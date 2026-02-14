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

Provide a comprehensive analysis including:
1. Understanding of the problem
2. Key technical considerations
3. Relevant existing code/patterns to be aware of
4. Potential challenges and risks

If you have questions that need the developer's input before the research is complete, include them in the "questions" array. For each question:
- Provide a "proposed_answer" with your best guess
- Provide an "options" array with 2-4 selectable choices the developer can pick from (the developer can also write a custom answer)

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
    },
    {
      id: crypto.randomUUID(),
      project_id: projectId,
      name: "Refinement",
      description:
        "Review implementation and incorporate developer feedback for improvements.",
      sort_order: 4,
      prompt_template: `Review the implementation and apply the following feedback/refinements.

Task: {{task_description}}

Previous implementation output:
{{previous_output}}

{{#if user_input}}
Developer feedback:
{{user_input}}
{{/if}}

Make the requested improvements while maintaining code quality and consistency.`,
      input_source: "both",
      output_format: "text",
      output_schema: null,
      gate_rules: JSON.stringify({ type: "require_approval" }),
      persona_name: null,
      persona_system_prompt: null,
      persona_model: null,
      preparation_prompt: null,
      allowed_tools: null, // Full tool access
    },
    {
      id: crypto.randomUUID(),
      project_id: projectId,
      name: "Security Review",
      description:
        "Analyze the implementation for security vulnerabilities and best practices.",
      sort_order: 5,
      prompt_template: `Perform a thorough security review of the changes made for this task.

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

Respond with a JSON object:
{
  "items": [
    {
      "id": "finding-1",
      "text": "Description of finding",
      "severity": "critical|warning|info",
      "checked": false,
      "notes": ""
    }
  ]
}`,
      input_source: "previous_stage",
      output_format: "checklist",
      output_schema: JSON.stringify({
        type: "object",
        properties: {
          items: {
            type: "array",
            items: {
              type: "object",
              properties: {
                id: { type: "string" },
                text: { type: "string" },
                severity: {
                  type: "string",
                  enum: ["critical", "warning", "info"],
                },
                checked: { type: "boolean" },
                notes: { type: "string" },
              },
              required: ["id", "text", "severity", "checked", "notes"],
            },
          },
        },
        required: ["items"],
      }),
      gate_rules: JSON.stringify({ type: "require_all_checked" }),
      persona_name: null,
      persona_system_prompt: null,
      persona_model: null,
      preparation_prompt: null,
      allowed_tools: JSON.stringify(["Read", "Glob", "Grep"]),
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
    },
  ];
}
