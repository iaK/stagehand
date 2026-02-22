// Migration-specific prompt templates and schemas.
// These use {{previous_output}} instead of MCP tool references,
// used by migrations to update existing projects to newer prompt formats.
// JSON schemas are imported from the shared stagePrompts module.

export {
  RESEARCH_SCHEMA,
  FINDINGS_SCHEMA,
  APPROACHES_SCHEMA,
  PLANNING_SCHEMA,
  TASK_SPLITTING_SCHEMA,
  TASK_SPLITTING_PROMPT,
} from "../prompts/stagePrompts";

// The Research prompt is identical for both migrations and seeds
// (it uses {{available_stages}} which is rendered at runtime).
export { RESEARCH_PROMPT } from "../prompts/stagePrompts";

// Migration-specific prompts that use {{previous_output}} instead of MCP tools.
// Existing projects get these during migration; new projects get the MCP-based
// versions from stagePrompts.ts via seed.ts.

export const REFINEMENT_FINDINGS_PROMPT = `{{#if prior_attempt_output}}You are applying selected refinements to an implementation.

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

Respond with a JSON object matching the output schema.{{/if}}`;

export const SECURITY_FINDINGS_PROMPT = `{{#if prior_attempt_output}}You are applying selected security fixes to an implementation.

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

Respond with a JSON object matching the output schema.{{/if}}`;

export const APPROACHES_PROMPT = `You are a senior software architect proposing implementation approaches for a task.

Task: {{task_description}}

Research findings:
{{previous_output}}

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

Selected approach:
{{user_decision}}

Previous research and context:
{{previous_output}}

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

export const DOCUMENTATION_PROMPT = `You are a senior technical writer documenting changes made during a development task.

Task: {{task_description}}

{{#if stage_summaries}}
## Stage Summaries

{{stage_summaries}}
{{/if}}

{{#if all_stage_outputs}}
## Full Stage Outputs

{{all_stage_outputs}}
{{/if}}

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

export const PR_PREP_PROMPT = `Prepare a pull request for the following completed task.

Task: {{task_description}}

{{#if stage_summaries}}
## Stage Summaries

{{stage_summaries}}
{{/if}}

{{#if previous_output}}
Full implementation details (for reference):
{{previous_output}}
{{/if}}

Generate:
1. A concise PR title
2. A detailed description explaining the changes
3. A test plan describing how to verify the changes

Respond with a JSON object matching the output schema.`;
