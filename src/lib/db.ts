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

  // Migrate Research stage: text → research format
  await migrateResearchStage(db);

  // Migrate Refinement stage: passive feedback → active self-review
  await migrateRefinementStage(db);
}

const RESEARCH_PROMPT = `You are a senior software engineer researching a task. Analyze the following task thoroughly.

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
  },
  required: ["research", "questions"],
});

const REFINEMENT_PROMPT = `You are performing a critical self-review of an implementation that was just completed. Act as a thorough code reviewer who questions the work before it ships.

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

{{#if user_input}}
## Developer Feedback
The developer has also provided specific feedback to address:
{{user_input}}
{{/if}}

## Instructions

Based on your review (and any developer feedback above), make all necessary improvements directly in the code. Fix issues, clean up problems, and ensure consistency.

If the implementation is solid and needs no changes, say so explicitly — do not make changes for the sake of making changes.

Provide a summary of what you reviewed and what you changed (or why no changes were needed).`;

const REFINEMENT_DESCRIPTION = "Self-review the implementation: catch oversights, clean up code, and verify codebase consistency.";

async function migrateRefinementStage(db: Database): Promise<void> {
  // Update Refinement stages that still have the old passive prompt
  const rows = await db.select<{ id: string; prompt_template: string }[]>(
    "SELECT id, prompt_template FROM stage_templates WHERE name = 'Refinement' AND sort_order = 4",
  );
  for (const row of rows) {
    if (row.prompt_template.includes("apply the following feedback/refinements")) {
      await db.execute(
        "UPDATE stage_templates SET prompt_template = $1, description = $2, updated_at = $3 WHERE id = $4",
        [REFINEMENT_PROMPT, REFINEMENT_DESCRIPTION, new Date().toISOString(), row.id],
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
