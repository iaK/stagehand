import Database from "@tauri-apps/plugin-sql";
import { invoke } from "@tauri-apps/api/core";

let devflowDir: string | null = null;

async function getDevflowDir(): Promise<string> {
  if (!devflowDir) {
    devflowDir = await invoke<string>("get_devflow_dir");
  }
  return devflowDir;
}

const connections: Record<string, Database> = {};

export async function getAppDb(): Promise<Database> {
  if (!connections["app"]) {
    const dir = await getDevflowDir();
    connections["app"] = await Database.load(`sqlite:${dir}/app.db`);
    await initAppSchema(connections["app"]);
  }
  return connections["app"];
}

export async function getProjectDb(projectId: string): Promise<Database> {
  const key = `project:${projectId}`;
  if (!connections[key]) {
    const dir = await getDevflowDir();
    connections[key] = await Database.load(
      `sqlite:${dir}/data/${projectId}.db`,
    );
    await initProjectSchema(connections[key]);
  }
  return connections[key];
}

async function initAppSchema(db: Database): Promise<void> {
  await db.execute(`
    CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      path TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

  await db.execute(`
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    )
  `);

  await db.execute(`
    ALTER TABLE projects ADD COLUMN archived INTEGER NOT NULL DEFAULT 0
  `).catch(() => { /* column already exists */ });

  // Clean up orphaned global linear_api_key (now per-project)
  await db.execute("DELETE FROM settings WHERE key = 'linear_api_key'");
}

async function initProjectSchema(db: Database): Promise<void> {
  await db.execute(`
    CREATE TABLE IF NOT EXISTS stage_templates (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      name TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      sort_order INTEGER NOT NULL DEFAULT 0,
      prompt_template TEXT NOT NULL DEFAULT '',
      input_source TEXT NOT NULL DEFAULT 'user',
      output_format TEXT NOT NULL DEFAULT 'text',
      output_schema TEXT,
      gate_rules TEXT NOT NULL DEFAULT '{"type":"require_approval"}',
      persona_name TEXT,
      persona_system_prompt TEXT,
      persona_model TEXT,
      preparation_prompt TEXT,
      allowed_tools TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

  await db.execute(`
    CREATE TABLE IF NOT EXISTS tasks (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      title TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      current_stage_id TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      archived INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

  await db.execute(`
    ALTER TABLE tasks ADD COLUMN archived INTEGER NOT NULL DEFAULT 0
  `).catch(() => { /* column already exists */ });

  await db.execute(`
    CREATE TABLE IF NOT EXISTS stage_executions (
      id TEXT PRIMARY KEY,
      task_id TEXT NOT NULL,
      stage_template_id TEXT NOT NULL,
      attempt_number INTEGER NOT NULL DEFAULT 1,
      status TEXT NOT NULL DEFAULT 'pending',
      input_prompt TEXT NOT NULL DEFAULT '',
      user_input TEXT,
      raw_output TEXT,
      parsed_output TEXT,
      user_decision TEXT,
      session_id TEXT,
      error_message TEXT,
      started_at TEXT NOT NULL DEFAULT (datetime('now')),
      completed_at TEXT,
      FOREIGN KEY (task_id) REFERENCES tasks(id),
      FOREIGN KEY (stage_template_id) REFERENCES stage_templates(id)
    )
  `);

  await db.execute(`
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    )
  `);

  await db.execute(`
    CREATE TABLE IF NOT EXISTS task_stages (
      id TEXT PRIMARY KEY,
      task_id TEXT NOT NULL,
      stage_template_id TEXT NOT NULL,
      sort_order INTEGER NOT NULL,
      FOREIGN KEY (task_id) REFERENCES tasks(id),
      FOREIGN KEY (stage_template_id) REFERENCES stage_templates(id),
      UNIQUE(task_id, stage_template_id)
    )
  `);

  await db.execute(`
    ALTER TABLE stage_executions ADD COLUMN user_input TEXT
  `).catch(() => { /* column already exists */ });

  await db.execute(`
    ALTER TABLE stage_executions ADD COLUMN thinking_output TEXT
  `).catch(() => { /* column already exists */ });

  await db.execute(`
    ALTER TABLE stage_executions ADD COLUMN stage_result TEXT
  `).catch(() => { /* column already exists */ });

  await db.execute(`
    ALTER TABLE stage_templates ADD COLUMN result_mode TEXT NOT NULL DEFAULT 'replace'
  `).catch(() => { /* column already exists */ });

  await db.execute(`
    ALTER TABLE tasks ADD COLUMN branch_name TEXT
  `).catch(() => { /* column already exists */ });

  // Migrate Research stage: text → research format
  await migrateResearchStage(db);

  // Migrate Refinement & Security Review stages: old formats → findings format
  await migrateFindingsStages(db);

  // Migrate Research stage: add suggested_stages to prompt/schema
  await migrateResearchStageSuggestions(db);
}

const RESEARCH_PROMPT = `You are a senior software engineer researching a task. Analyze the following task thoroughly.

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

Additionally, suggest which pipeline stages this task needs. The available stages are:
- "High-Level Approaches": Brainstorm and compare multiple approaches (useful for complex tasks with multiple viable solutions)
- "Planning": Create a detailed implementation plan (useful for non-trivial changes)
- "Implementation": Write the actual code changes (almost always needed)
- "Refinement": Self-review the implementation for quality issues (useful for larger changes)
- "Security Review": Check for security vulnerabilities (useful when dealing with auth, user input, APIs, or data handling)
- "PR Preparation": Prepare a pull request with title and description (useful when changes will be submitted as a PR)

For simple bug fixes, you might only need Implementation. For large features, you might need all stages.
Include your suggestions in the "suggested_stages" array.

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
  ],
  "suggested_stages": [
    { "name": "Implementation", "reason": "Code changes are needed" },
    { "name": "PR Preparation", "reason": "Changes should be submitted as a PR" }
  ]
}`;

const RESEARCH_SCHEMA = JSON.stringify({
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

const FINDINGS_SCHEMA = JSON.stringify({
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

const REFINEMENT_FINDINGS_PROMPT = `{{#if prior_attempt_output}}You are applying selected refinements to an implementation.

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
}{{/if}}`;

const SECURITY_FINDINGS_PROMPT = `{{#if prior_attempt_output}}You are applying selected security fixes to an implementation.

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
}{{/if}}`;

async function migrateFindingsStages(db: Database): Promise<void> {
  const now = new Date().toISOString();

  // Migrate Refinement stages that aren't using findings format yet
  const refinementRows = await db.select<{ id: string; output_format: string }[]>(
    "SELECT id, output_format FROM stage_templates WHERE name = 'Refinement' AND sort_order = 4",
  );
  for (const row of refinementRows) {
    if (row.output_format !== "findings") {
      await db.execute(
        `UPDATE stage_templates SET
          output_format = $1, output_schema = $2, prompt_template = $3,
          gate_rules = $4, allowed_tools = $5, result_mode = $6,
          description = $7, input_source = $8, updated_at = $9
        WHERE id = $10`,
        [
          "findings", FINDINGS_SCHEMA, REFINEMENT_FINDINGS_PROMPT,
          JSON.stringify({ type: "require_approval" }), null, "append",
          "Self-review the implementation: identify issues for the developer to select, then apply chosen fixes.",
          "previous_stage", now, row.id,
        ],
      );
    }
  }

  // Migrate Security Review stages that aren't using findings format yet
  const securityRows = await db.select<{ id: string; output_format: string }[]>(
    "SELECT id, output_format FROM stage_templates WHERE name = 'Security Review' AND sort_order = 5",
  );
  for (const row of securityRows) {
    if (row.output_format !== "findings") {
      await db.execute(
        `UPDATE stage_templates SET
          output_format = $1, output_schema = $2, prompt_template = $3,
          gate_rules = $4, allowed_tools = $5, result_mode = $6,
          description = $7, updated_at = $8
        WHERE id = $9`,
        [
          "findings", FINDINGS_SCHEMA, SECURITY_FINDINGS_PROMPT,
          JSON.stringify({ type: "require_approval" }), null, "append",
          "Analyze for security vulnerabilities, then apply selected fixes.",
          now, row.id,
        ],
      );
    }
  }
}

async function migrateResearchStageSuggestions(db: Database): Promise<void> {
  // Migrate Research stages that don't have suggested_stages in their schema
  const rows = await db.select<{ id: string; output_schema: string }[]>(
    "SELECT id, output_schema FROM stage_templates WHERE name = 'Research' AND output_format = 'research' AND sort_order = 0",
  );
  for (const row of rows) {
    if (row.output_schema && !row.output_schema.includes('"suggested_stages"')) {
      await db.execute(
        "UPDATE stage_templates SET output_schema = $1, prompt_template = $2, updated_at = $3 WHERE id = $4",
        [RESEARCH_SCHEMA, RESEARCH_PROMPT, new Date().toISOString(), row.id],
      );
    }
  }
}

async function migrateResearchStage(db: Database): Promise<void> {
  // Find Research stages still using old text format
  const rows = await db.select<{ id: string }[]>(
    "SELECT id FROM stage_templates WHERE name = 'Research' AND output_format = 'text' AND sort_order = 0",
  );
  for (const row of rows) {
    await db.execute(
      "UPDATE stage_templates SET output_format = $1, output_schema = $2, prompt_template = $3, updated_at = $4 WHERE id = $5",
      ["research", RESEARCH_SCHEMA, RESEARCH_PROMPT, new Date().toISOString(), row.id],
    );
  }

  // Migrate existing research stages that lack the options property in their schema
  const researchRows = await db.select<{ id: string; output_schema: string }[]>(
    "SELECT id, output_schema FROM stage_templates WHERE name = 'Research' AND output_format = 'research' AND sort_order = 0",
  );
  for (const row of researchRows) {
    if (row.output_schema && !row.output_schema.includes('"options"')) {
      await db.execute(
        "UPDATE stage_templates SET output_schema = $1, prompt_template = $2, updated_at = $3 WHERE id = $4",
        [RESEARCH_SCHEMA, RESEARCH_PROMPT, new Date().toISOString(), row.id],
      );
    }
  }
}
