import type { StageTemplate } from "./types";
import {
  RESEARCH_PROMPT,
  RESEARCH_SCHEMA,
  APPROACHES_PROMPT,
  APPROACHES_SCHEMA,
  PLANNING_PROMPT,
  PLANNING_SCHEMA,
  IMPLEMENTATION_PROMPT,
  REFINEMENT_FINDINGS_PROMPT,
  FINDINGS_SCHEMA,
  SECURITY_FINDINGS_PROMPT,
  DOCUMENTATION_PROMPT,
  PR_PREPARATION_PROMPT,
  PR_PREPARATION_SCHEMA,
  TASK_SPLITTING_PROMPT,
  TASK_SPLITTING_SCHEMA,
} from "./prompts/stagePrompts";

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
      prompt_template: RESEARCH_PROMPT,
      input_source: "user",
      output_format: "research",
      output_schema: RESEARCH_SCHEMA,
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
      name: "Task Splitting",
      description:
        "Decompose a large task into smaller, independent subtasks.",
      sort_order: 1,
      prompt_template: TASK_SPLITTING_PROMPT,
      input_source: "previous_stage",
      output_format: "task_splitting",
      output_schema: TASK_SPLITTING_SCHEMA,
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
      name: "High-Level Approaches",
      description:
        "Generate multiple implementation approaches based on the research.",
      sort_order: 2,
      prompt_template: APPROACHES_PROMPT,
      input_source: "previous_stage",
      output_format: "options",
      output_schema: APPROACHES_SCHEMA,
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
      sort_order: 3,
      prompt_template: PLANNING_PROMPT,
      input_source: "previous_stage",
      output_format: "plan",
      output_schema: PLANNING_SCHEMA,
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
      name: "Second Opinion",
      description:
        "Critique the implementation plan — identify risks, gaps, and improvements for the developer to select, then revise the plan.",
      sort_order: 4,
      prompt_template: `{{#if prior_attempt_output}}You are revising an implementation plan based on the developer's selected concerns.

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

Respond with a JSON object:
{
  "summary": "The full original plan text verbatim when no issues are found, OR a brief assessment when findings exist",
  "findings": [
    {
      "id": "c1",
      "title": "Short title of the concern",
      "description": "Detailed description of the issue and what should change in the plan",
      "severity": "critical|warning|info",
      "category": "completeness|correctness|risk|simplicity|ordering",
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
      allowed_tools: JSON.stringify(["Read", "Glob", "Grep"]),
      requires_user_input: 0,
    },
    {
      id: crypto.randomUUID(),
      project_id: projectId,
      name: "Guided Implementation",
      description:
        "Interactive agent session — you guide the AI step by step in a live terminal.",
      sort_order: 5,
      prompt_template: "",
      input_source: "previous_stage",
      output_format: "interactive_terminal",
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
      name: "Implementation",
      description:
        "Execute the implementation plan — write code, create files, run commands.",
      sort_order: 6,
      prompt_template: IMPLEMENTATION_PROMPT,
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
      sort_order: 7,
      prompt_template: REFINEMENT_FINDINGS_PROMPT,
      input_source: "previous_stage",
      output_format: "findings",
      output_schema: FINDINGS_SCHEMA,
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
      sort_order: 8,
      prompt_template: SECURITY_FINDINGS_PROMPT,
      input_source: "previous_stage",
      output_format: "findings",
      output_schema: FINDINGS_SCHEMA,
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
      sort_order: 9,
      prompt_template: DOCUMENTATION_PROMPT,
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
      sort_order: 10,
      prompt_template: PR_PREPARATION_PROMPT,
      input_source: "previous_stage",
      output_format: "pr_preparation",
      output_schema: PR_PREPARATION_SCHEMA,
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
      sort_order: 11,
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
      sort_order: 12,
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
