import type Database from "@tauri-apps/plugin-sql";
import { logger } from "../logger";
import {
  RESEARCH_PROMPT,
  RESEARCH_SCHEMA,
  FINDINGS_SCHEMA,
  REFINEMENT_FINDINGS_PROMPT,
  SECURITY_FINDINGS_PROMPT,
  APPROACHES_PROMPT,
  APPROACHES_SCHEMA,
  PLANNING_PROMPT,
  PLANNING_SCHEMA,
  DOCUMENTATION_PROMPT,
  PR_PREP_PROMPT,
  TASK_SPLITTING_PROMPT,
  TASK_SPLITTING_SCHEMA,
} from "./prompts";

// === Migration Registry ===

interface Migration {
  version: number;
  name: string;
  fn: (db: Database) => Promise<void>;
}

const MIGRATIONS: Migration[] = [
  { version: 1, name: "behavior_flags", fn: migrateBehaviorFlags },
  { version: 2, name: "research_available_stages", fn: migrateResearchAvailableStages },
  { version: 3, name: "research_stage", fn: migrateResearchStage },
  { version: 4, name: "findings_stages", fn: migrateFindingsStages },
  { version: 5, name: "research_stage_suggestions", fn: migrateResearchStageSuggestions },
  { version: 6, name: "interactive_stages", fn: migrateInteractiveStages },
  { version: 7, name: "pr_prep_summaries", fn: migratePrPrepSummaries },
  { version: 8, name: "pr_review_stage", fn: migratePrReviewStage },
  { version: 9, name: "merge_stage", fn: migrateMergeStage },
  { version: 10, name: "pr_preparation_format", fn: migratePrPreparationFormat },
  { version: 11, name: "documentation_stage", fn: migrateDocumentationStage },
  { version: 12, name: "second_opinion_stage", fn: migrateSecondOpinionStage },
  { version: 13, name: "task_splitting_stage", fn: migrateTaskSplittingStage },
  { version: 14, name: "guided_implementation_stage", fn: migrateGuidedImplementationStage },
  { version: 15, name: "agent_agnostic_descriptions", fn: migrateAgentAgnosticDescriptions },
  { version: 16, name: "drop_task_description", fn: migrateDropTaskDescription },
];

/**
 * Run any pending migrations that haven't been applied yet.
 * On first run with an existing database, detects the baseline and skips
 * already-applied migrations.
 */
export async function runPendingMigrations(db: Database): Promise<void> {
  // Ensure the _migrations table exists
  await db.execute(`
    CREATE TABLE IF NOT EXISTS _migrations (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

  // Check what's already been applied
  const rows = await db.select<{ version: number }[]>(
    "SELECT version FROM _migrations ORDER BY version ASC",
  );
  const appliedVersions = new Set(rows.map((r) => r.version));

  // Baseline detection: if the table is empty but the database has data,
  // figure out which migrations are already applied
  if (appliedVersions.size === 0) {
    const baseline = await detectBaseline(db);
    if (baseline > 0) {
      logger.info(`Detected existing database at baseline version ${baseline}`);
      const now = new Date().toISOString();
      for (const m of MIGRATIONS) {
        if (m.version <= baseline) {
          await db.execute(
            "INSERT OR IGNORE INTO _migrations (version, name, applied_at) VALUES ($1, $2, $3)",
            [m.version, m.name, now],
          );
          appliedVersions.add(m.version);
        }
      }
    }
  }

  // Run pending migrations in order
  for (const migration of MIGRATIONS) {
    if (appliedVersions.has(migration.version)) continue;
    logger.info(`Running migration ${migration.version}: ${migration.name}`);
    await migration.fn(db);
    await db.execute(
      "INSERT INTO _migrations (version, name, applied_at) VALUES ($1, $2, $3)",
      [migration.version, migration.name, new Date().toISOString()],
    );
  }
}

/**
 * Detect the baseline migration version for an existing database
 * by probing for features added by later migrations.
 */
async function detectBaseline(db: Database): Promise<number> {
  // Check for features in reverse order (newest first) to find the highest applied migration
  try {
    // v14: Guided Implementation stage exists
    const giRows = await db.select<{ id: string }[]>(
      "SELECT id FROM stage_templates WHERE name = 'Guided Implementation' LIMIT 1",
    );
    if (giRows.length > 0) return 14;

    // v13: Task Splitting stage exists
    const tsRows = await db.select<{ id: string }[]>(
      "SELECT id FROM stage_templates WHERE name = 'Task Splitting' LIMIT 1",
    );
    if (tsRows.length > 0) return 13;

    // v12: Second Opinion stage exists
    const soRows = await db.select<{ id: string }[]>(
      "SELECT id FROM stage_templates WHERE name = 'Second Opinion' LIMIT 1",
    );
    if (soRows.length > 0) return 12;

    // v11: Documentation stage exists
    const docRows = await db.select<{ id: string }[]>(
      "SELECT id FROM stage_templates WHERE name = 'Documentation' LIMIT 1",
    );
    if (docRows.length > 0) return 11;

    // v10: pr_preparation format exists
    const prPrepRows = await db.select<{ id: string }[]>(
      "SELECT id FROM stage_templates WHERE output_format = 'pr_preparation' LIMIT 1",
    );
    if (prPrepRows.length > 0) return 10;

    // v9: Merge stage exists
    const mergeRows = await db.select<{ id: string }[]>(
      "SELECT id FROM stage_templates WHERE name = 'Merge' LIMIT 1",
    );
    if (mergeRows.length > 0) return 9;

    // v8: PR Review stage exists
    const prReviewRows = await db.select<{ id: string }[]>(
      "SELECT id FROM stage_templates WHERE name = 'PR Review' LIMIT 1",
    );
    if (prReviewRows.length > 0) return 8;

    // v7: PR prep summaries — prompt contains {{stage_summaries}}
    const prPrepSummaryRows = await db.select<{ cnt: number }[]>(
      "SELECT COUNT(*) as cnt FROM stage_templates WHERE name = 'PR Preparation' AND prompt_template LIKE '%{{stage_summaries}}%'",
    );
    if (prPrepSummaryRows[0]?.cnt > 0) return 7;

    // v6: Interactive stages — Planning uses 'plan' format with questions
    const planFormatRows = await db.select<{ cnt: number }[]>(
      "SELECT COUNT(*) as cnt FROM stage_templates WHERE name = 'Planning' AND output_format = 'plan'",
    );
    if (planFormatRows[0]?.cnt > 0) return 6;

    // v4: Findings stages — Refinement uses 'findings' format
    const findingsRows = await db.select<{ cnt: number }[]>(
      "SELECT COUNT(*) as cnt FROM stage_templates WHERE name = 'Refinement' AND output_format = 'findings'",
    );
    if (findingsRows[0]?.cnt > 0) return 5; // v4 and v5 both touch Research/Refinement

    // v1: behavior_flags set
    const flagRows = await db.select<{ cnt: number }[]>(
      "SELECT COUNT(*) as cnt FROM stage_templates WHERE commits_changes = 1 OR creates_pr = 1",
    );
    if (flagRows[0]?.cnt > 0) return 1;

    // Check if stage_templates has any data at all (indicates it's not a fresh DB)
    const anyRows = await db.select<{ cnt: number }[]>(
      "SELECT COUNT(*) as cnt FROM stage_templates",
    );
    if (anyRows[0]?.cnt > 0) return 0; // Has data but no migration markers — run all
  } catch {
    // Table doesn't exist or query failed — fresh database
  }

  return 0; // Fresh database — run all migrations
}

export async function migrateBehaviorFlags(db: Database): Promise<void> {
  // Only run if flags haven't been set yet (check if any row has commits_changes = 1)
  const alreadyMigrated = await db.select<{ cnt: number }[]>(
    "SELECT COUNT(*) as cnt FROM stage_templates WHERE commits_changes = 1 OR creates_pr = 1 OR is_terminal = 1 OR triggers_stage_selection = 1",
  );
  if (alreadyMigrated[0]?.cnt > 0) return;

  const now = new Date().toISOString();

  // Implementation (sort_order 3): commits_changes, commit_prefix = "feat"
  await db.execute(
    `UPDATE stage_templates SET commits_changes = 1, commit_prefix = 'feat', updated_at = $1 WHERE name = 'Implementation' AND sort_order = 3`,
    [now],
  );

  // Refinement (sort_order 4): commits_changes, commit_prefix = "fix"
  await db.execute(
    `UPDATE stage_templates SET commits_changes = 1, commit_prefix = 'fix', updated_at = $1 WHERE name = 'Refinement' AND sort_order = 4`,
    [now],
  );

  // Security Review (sort_order 5): commits_changes, commit_prefix = "fix"
  await db.execute(
    `UPDATE stage_templates SET commits_changes = 1, commit_prefix = 'fix', updated_at = $1 WHERE name = 'Security Review' AND sort_order = 5`,
    [now],
  );

  // PR Preparation (sort_order 6): creates_pr
  await db.execute(
    `UPDATE stage_templates SET creates_pr = 1, updated_at = $1 WHERE name = 'PR Preparation' AND sort_order = 6`,
    [now],
  );

  // Research (sort_order 0): triggers_stage_selection
  await db.execute(
    `UPDATE stage_templates SET triggers_stage_selection = 1, updated_at = $1 WHERE name = 'Research' AND sort_order = 0`,
    [now],
  );

  // PR Review (sort_order 7): is_terminal
  await db.execute(
    `UPDATE stage_templates SET is_terminal = 1, updated_at = $1 WHERE name = 'PR Review' AND sort_order = 7`,
    [now],
  );

  // Merge: is_terminal (any sort_order since it varies)
  await db.execute(
    `UPDATE stage_templates SET is_terminal = 1, updated_at = $1 WHERE name = 'Merge'`,
    [now],
  );
}

export async function migrateResearchAvailableStages(db: Database): Promise<void> {
  // Find Research stages that still have the hardcoded stage list
  const rows = await db.select<{ id: string; prompt_template: string }[]>(
    "SELECT id, prompt_template FROM stage_templates WHERE name = 'Research' AND output_format = 'research' AND sort_order = 0",
  );
  for (const row of rows) {
    // Check if the prompt has the hardcoded list but not the {{available_stages}} variable
    if (
      row.prompt_template.includes('"High-Level Approaches"') &&
      !row.prompt_template.includes("{{available_stages}}")
    ) {
      // Replace the hardcoded stage list with the template variable
      const updated = row.prompt_template.replace(
        /The available stages are:\n(?:- "[^"]+":? [^\n]*\n)+/,
        "The available stages are:\n{{available_stages}}\n",
      );
      if (updated !== row.prompt_template) {
        await db.execute(
          "UPDATE stage_templates SET prompt_template = $1, updated_at = $2 WHERE id = $3",
          [updated, new Date().toISOString(), row.id],
        );
      }
    }
  }
}

export async function migrateFindingsStages(db: Database): Promise<void> {
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

export async function migrateResearchStageSuggestions(db: Database): Promise<void> {
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

export async function migrateResearchStage(db: Database): Promise<void> {
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

export async function migratePrPrepSummaries(db: Database): Promise<void> {
  const rows = await db.select<{ id: string; prompt_template: string }[]>(
    "SELECT id, prompt_template FROM stage_templates WHERE name = 'PR Preparation' AND sort_order = 6",
  );
  for (const row of rows) {
    // Skip if already has {{stage_summaries}} (migration already applied)
    // or if using MCP-based prompt (newer than this migration)
    if (row.prompt_template.includes("{{stage_summaries}}") || row.prompt_template.includes("get_stage_output")) {
      continue;
    }
    await db.execute(
      "UPDATE stage_templates SET prompt_template = $1, updated_at = $2 WHERE id = $3",
      [PR_PREP_PROMPT, new Date().toISOString(), row.id],
    );
  }
}

export async function migrateInteractiveStages(db: Database): Promise<void> {
  const now = new Date().toISOString();

  // Migrate Research stage prompt to pure research (no implementation planning)
  const researchRows = await db.select<{ id: string; prompt_template: string }[]>(
    "SELECT id, prompt_template FROM stage_templates WHERE name = 'Research' AND output_format = 'research' AND sort_order = 0",
  );
  for (const row of researchRows) {
    if (!row.prompt_template.includes("Your ONLY job is to investigate")) {
      await db.execute(
        "UPDATE stage_templates SET prompt_template = $1, updated_at = $2 WHERE id = $3",
        [RESEARCH_PROMPT, now, row.id],
      );
    }
  }

  // Migrate High-Level Approaches to support questions
  const approachRows = await db.select<{ id: string; output_schema: string | null }[]>(
    "SELECT id, output_schema FROM stage_templates WHERE name = 'High-Level Approaches' AND output_format = 'options' AND sort_order = 1",
  );
  for (const row of approachRows) {
    if (!row.output_schema || !row.output_schema.includes('"questions"')) {
      await db.execute(
        "UPDATE stage_templates SET prompt_template = $1, output_schema = $2, updated_at = $3 WHERE id = $4",
        [APPROACHES_PROMPT, APPROACHES_SCHEMA, now, row.id],
      );
    }
  }

  // Migrate Planning stage: text → plan format with questions
  const planningTextRows = await db.select<{ id: string }[]>(
    "SELECT id FROM stage_templates WHERE name = 'Planning' AND output_format = 'text' AND sort_order = 2",
  );
  for (const row of planningTextRows) {
    await db.execute(
      "UPDATE stage_templates SET output_format = $1, output_schema = $2, prompt_template = $3, updated_at = $4 WHERE id = $5",
      ["plan", PLANNING_SCHEMA, PLANNING_PROMPT, now, row.id],
    );
  }

  // Also update Planning stages that are already 'plan' format but lack questions in schema
  const planningPlanRows = await db.select<{ id: string; output_schema: string | null }[]>(
    "SELECT id, output_schema FROM stage_templates WHERE name = 'Planning' AND output_format = 'plan' AND sort_order = 2",
  );
  for (const row of planningPlanRows) {
    if (!row.output_schema || !row.output_schema.includes('"questions"')) {
      await db.execute(
        "UPDATE stage_templates SET output_schema = $1, prompt_template = $2, updated_at = $3 WHERE id = $4",
        [PLANNING_SCHEMA, PLANNING_PROMPT, now, row.id],
      );
    }
  }
}

export async function migratePrReviewStage(db: Database): Promise<void> {
  // Check if PR Review already exists
  const existing = await db.select<{ id: string }[]>(
    "SELECT id FROM stage_templates WHERE name = 'PR Review' AND sort_order = 7",
  );
  if (existing.length > 0) return;

  // Only add if PR Preparation exists at sort_order 6
  const prPrepRows = await db.select<{ id: string; project_id: string }[]>(
    "SELECT id, project_id FROM stage_templates WHERE name = 'PR Preparation' AND sort_order = 6",
  );
  if (prPrepRows.length === 0) return;

  const now = new Date().toISOString();
  for (const row of prPrepRows) {
    await db.execute(
      `INSERT INTO stage_templates (id, project_id, name, description, sort_order, prompt_template, input_source, output_format, output_schema, gate_rules, persona_name, persona_system_prompt, persona_model, preparation_prompt, allowed_tools, result_mode, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)`,
      [
        crypto.randomUUID(),
        row.project_id,
        "PR Review",
        "Fetch PR reviews from GitHub, fix reviewer comments, and complete the task.",
        7,
        "",
        "previous_stage",
        "pr_review",
        null,
        JSON.stringify({ type: "require_approval" }),
        null,
        null,
        null,
        null,
        null,
        "replace",
        now,
        now,
      ],
    );
  }
}

export async function migrateMergeStage(db: Database): Promise<void> {
  // Check if any Merge stage already exists (across any project)
  const existing = await db.select<{ id: string }[]>(
    "SELECT id FROM stage_templates WHERE name = 'Merge'",
  );
  if (existing.length > 0) return;

  // Find all projects that have stage templates but no Merge stage.
  // Place the Merge stage after the highest existing sort_order in each project.
  const projectRows = await db.select<{ project_id: string; max_order: number }[]>(
    `SELECT project_id, MAX(sort_order) as max_order
     FROM stage_templates
     GROUP BY project_id`,
  );
  if (projectRows.length === 0) return;

  const now = new Date().toISOString();
  for (const row of projectRows) {
    await db.execute(
      `INSERT INTO stage_templates (id, project_id, name, description, sort_order, prompt_template, input_source, output_format, output_schema, gate_rules, persona_name, persona_system_prompt, persona_model, preparation_prompt, allowed_tools, result_mode, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)`,
      [
        crypto.randomUUID(),
        row.project_id,
        "Merge",
        "Merge the task branch into the target branch and push.",
        row.max_order + 1,
        "",
        "previous_stage",
        "merge",
        null,
        JSON.stringify({ type: "require_approval" }),
        null,
        null,
        null,
        null,
        null,
        "replace",
        now,
        now,
      ],
    );
  }
}

export async function migratePrPreparationFormat(db: Database): Promise<void> {
  // Migrate PR Preparation stages from structured → pr_preparation using the creates_pr flag
  await db.execute(
    `UPDATE stage_templates SET output_format = 'pr_preparation' WHERE output_format = 'structured' AND creates_pr = 1`,
  ).catch(() => {});
}

export async function migrateDocumentationStage(db: Database): Promise<void> {
  // Idempotency: bail if Documentation already exists
  const existing = await db.select<{ id: string }[]>(
    "SELECT id FROM stage_templates WHERE name = 'Documentation'",
  );
  if (existing.length > 0) return;

  const now = new Date().toISOString();

  // Bump sort_order for all stages at sort_order >= 6 to make room for Documentation
  await db.execute(
    `UPDATE stage_templates SET sort_order = sort_order + 1, updated_at = $1
     WHERE sort_order >= 6`,
    [now],
  );

  // Insert Documentation stage for every project
  const projectRows = await db.select<{ project_id: string }[]>(
    "SELECT DISTINCT project_id FROM stage_templates",
  );

  for (const row of projectRows) {
    await db.execute(
      `INSERT INTO stage_templates (id, project_id, name, description, sort_order, prompt_template, input_source, output_format, output_schema, gate_rules, persona_name, persona_system_prompt, persona_model, preparation_prompt, allowed_tools, result_mode, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)`,
      [
        crypto.randomUUID(),
        row.project_id,
        "Documentation",
        "Write or update documentation based on the changes made in this task.",
        6,
        DOCUMENTATION_PROMPT,
        "both",
        "text",
        null,
        JSON.stringify({ type: "require_approval" }),
        null,
        null,
        null,
        null,
        null,
        "replace",
        now,
        now,
      ],
    );
  }

  // Set behavior flags
  await db.execute(
    `UPDATE stage_templates SET commits_changes = 1, commit_prefix = 'docs', updated_at = $1 WHERE name = 'Documentation'`,
    [now],
  );
}

const SECOND_OPINION_PROMPT = `{{#if prior_attempt_output}}You are revising an implementation plan based on the developer's selected concerns.

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
}{{/if}}`;

export async function migrateSecondOpinionStage(db: Database): Promise<void> {
  // Idempotency: bail if Second Opinion already exists
  const existing = await db.select<{ id: string }[]>(
    "SELECT id FROM stage_templates WHERE name = 'Second Opinion'",
  );
  if (existing.length > 0) return;

  const now = new Date().toISOString();

  // Bump sort_order for all stages at sort_order >= 3 to make room for Second Opinion
  await db.execute(
    `UPDATE stage_templates SET sort_order = sort_order + 1, updated_at = $1
     WHERE sort_order >= 3`,
    [now],
  );

  // Insert Second Opinion stage for every project
  const projectRows = await db.select<{ project_id: string }[]>(
    "SELECT DISTINCT project_id FROM stage_templates",
  );

  for (const row of projectRows) {
    await db.execute(
      `INSERT INTO stage_templates (id, project_id, name, description, sort_order, prompt_template, input_source, output_format, output_schema, gate_rules, persona_name, persona_system_prompt, persona_model, preparation_prompt, allowed_tools, result_mode, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)`,
      [
        crypto.randomUUID(),
        row.project_id,
        "Second Opinion",
        "Critique the implementation plan — identify risks, gaps, and improvements for the developer to select, then revise the plan.",
        3,
        SECOND_OPINION_PROMPT,
        "previous_stage",
        "findings",
        JSON.stringify({
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
        JSON.stringify({ type: "require_approval" }),
        null,
        null,
        null,
        null,
        JSON.stringify(["Read", "Glob", "Grep"]),
        "replace",
        now,
        now,
      ],
    );
  }
}

export async function migrateTaskSplittingStage(db: Database): Promise<void> {
  // Step 1: Add parent_task_id column (idempotent via catch)
  await db.execute(
    `ALTER TABLE tasks ADD COLUMN parent_task_id TEXT`,
  ).catch(() => {});

  // Step 2: Insert Task Splitting stage template
  // Idempotency: bail if Task Splitting already exists
  const existing = await db.select<{ id: string }[]>(
    "SELECT id FROM stage_templates WHERE name = 'Task Splitting'",
  );
  if (existing.length > 0) return;

  const now = new Date().toISOString();

  // Bump sort_order for all stages at sort_order >= 1 to make room
  await db.execute(
    `UPDATE stage_templates SET sort_order = sort_order + 1, updated_at = $1
     WHERE sort_order >= 1`,
    [now],
  );

  // Insert Task Splitting stage for every project
  const projectRows = await db.select<{ project_id: string }[]>(
    "SELECT DISTINCT project_id FROM stage_templates",
  );

  for (const row of projectRows) {
    await db.execute(
      `INSERT INTO stage_templates (id, project_id, name, description, sort_order, prompt_template, input_source, output_format, output_schema, gate_rules, persona_name, persona_system_prompt, persona_model, preparation_prompt, allowed_tools, result_mode, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)`,
      [
        crypto.randomUUID(),
        row.project_id,
        "Task Splitting",
        "Decompose a large task into smaller, independent subtasks.",
        1,
        TASK_SPLITTING_PROMPT,
        "previous_stage",
        "task_splitting",
        TASK_SPLITTING_SCHEMA,
        JSON.stringify({ type: "require_approval" }),
        null,
        null,
        null,
        null,
        JSON.stringify(["Read", "Glob", "Grep"]),
        "replace",
        now,
        now,
      ],
    );
  }
}

export async function migrateGuidedImplementationStage(db: Database): Promise<void> {
  // Idempotency: bail if Guided Implementation already exists
  const existing = await db.select<{ id: string }[]>(
    "SELECT id FROM stage_templates WHERE name = 'Guided Implementation'",
  );
  if (existing.length > 0) return;

  const now = new Date().toISOString();

  // Insert Guided Implementation stage for every project at sort_order 5
  // (same as Implementation — opt-in via Research stage selection, not in default pipeline)
  const projectRows = await db.select<{ project_id: string }[]>(
    "SELECT DISTINCT project_id FROM stage_templates",
  );

  for (const row of projectRows) {
    await db.execute(
      `INSERT INTO stage_templates (id, project_id, name, description, sort_order, prompt_template, input_source, output_format, output_schema, gate_rules, persona_name, persona_system_prompt, persona_model, preparation_prompt, allowed_tools, result_mode, commits_changes, commit_prefix, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20)`,
      [
        crypto.randomUUID(),
        row.project_id,
        "Guided Implementation",
        "Interactive Claude session — you guide the AI step by step in a live terminal.",
        5,
        "",
        "previous_stage",
        "interactive_terminal",
        null,
        JSON.stringify({ type: "require_approval" }),
        null,
        null,
        null,
        null,
        null,
        "replace",
        1,
        "feat",
        now,
        now,
      ],
    );
  }
}

async function migrateAgentAgnosticDescriptions(db: Database): Promise<void> {
  await db.execute(
    `UPDATE stage_templates
     SET description = 'Interactive agent session — you guide the AI step by step in a live terminal.'
     WHERE name = 'Guided Implementation'
       AND description LIKE '%Interactive Claude session%'`,
  );
}

async function migrateDropTaskDescription(db: Database): Promise<void> {
  await db.execute(`ALTER TABLE tasks DROP COLUMN description`);
}
