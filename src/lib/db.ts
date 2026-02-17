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
const connectionPromises: Record<string, Promise<Database>> = {};

export async function getAppDb(): Promise<Database> {
  if (connections["app"]) return connections["app"];
  if (!connectionPromises["app"]) {
    connectionPromises["app"] = (async () => {
      const dir = await getDevflowDir();
      const db = await Database.load(`sqlite:${dir}/app.db`);
      await initAppSchema(db);
      connections["app"] = db;
      return db;
    })();
  }
  return connectionPromises["app"];
}

export async function getProjectDb(projectId: string): Promise<Database> {
  const key = `project:${projectId}`;
  if (connections[key]) return connections[key];
  if (!connectionPromises[key]) {
    connectionPromises[key] = (async () => {
      const dir = await getDevflowDir();
      const db = await Database.load(
        `sqlite:${dir}/data/${projectId}.db`,
      );
      await initProjectSchema(db);
      connections[key] = db;
      return db;
    })();
  }
  return connectionPromises[key];
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
    ALTER TABLE stage_executions ADD COLUMN stage_summary TEXT
  `).catch(() => { /* column already exists */ });

  await db.execute(`
    ALTER TABLE tasks ADD COLUMN branch_name TEXT
  `).catch(() => { /* column already exists */ });

  await db.execute(`
    ALTER TABLE tasks ADD COLUMN pr_url TEXT
  `).catch(() => { /* column already exists */ });

  await db.execute(`
    ALTER TABLE tasks ADD COLUMN worktree_path TEXT
  `).catch(() => { /* column already exists */ });

  // Migrate Research stage: text → research format
  await migrateResearchStage(db);

  // Migrate Refinement & Security Review stages: old formats → findings format
  await migrateFindingsStages(db);

  // Migrate Research stage: add suggested_stages to prompt/schema
  await migrateResearchStageSuggestions(db);

  // Migrate stages to support questions in High-Level Approaches and Planning
  await migrateInteractiveStages(db);

  // Migrate PR Preparation to use {{stage_summaries}}
  await migratePrPrepSummaries(db);

  // Add pr_review_fixes table and PR Review stage template
  await db.execute(`
    CREATE TABLE IF NOT EXISTS pr_review_fixes (
      id TEXT PRIMARY KEY,
      execution_id TEXT NOT NULL,
      comment_id INTEGER NOT NULL,
      comment_type TEXT NOT NULL DEFAULT 'inline',
      author TEXT NOT NULL DEFAULT '',
      author_avatar_url TEXT,
      body TEXT NOT NULL DEFAULT '',
      file_path TEXT,
      line INTEGER,
      diff_hunk TEXT,
      state TEXT NOT NULL DEFAULT 'COMMENTED',
      fix_status TEXT NOT NULL DEFAULT 'pending',
      fix_commit_hash TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (execution_id) REFERENCES stage_executions(id),
      UNIQUE(execution_id, comment_id, comment_type)
    )
  `);

  // Migrate: widen unique constraint from (execution_id, comment_id) to include comment_type
  await db.execute(`
    CREATE TABLE IF NOT EXISTS _pr_review_fixes_v2 (
      id TEXT PRIMARY KEY,
      execution_id TEXT NOT NULL,
      comment_id INTEGER NOT NULL,
      comment_type TEXT NOT NULL DEFAULT 'inline',
      author TEXT NOT NULL DEFAULT '',
      author_avatar_url TEXT,
      body TEXT NOT NULL DEFAULT '',
      file_path TEXT,
      line INTEGER,
      diff_hunk TEXT,
      state TEXT NOT NULL DEFAULT 'COMMENTED',
      fix_status TEXT NOT NULL DEFAULT 'pending',
      fix_commit_hash TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (execution_id) REFERENCES stage_executions(id),
      UNIQUE(execution_id, comment_id, comment_type)
    )
  `).catch(() => { /* table already exists */ });

  // If old table has wrong constraint, migrate data
  try {
    const oldInfo = await db.select<{ sql: string }[]>(
      "SELECT sql FROM sqlite_master WHERE type='table' AND name='pr_review_fixes'",
    );
    if (oldInfo.length > 0 && !oldInfo[0].sql.includes("comment_type)")) {
      await db.execute("INSERT OR IGNORE INTO _pr_review_fixes_v2 SELECT * FROM pr_review_fixes");
      await db.execute("DROP TABLE pr_review_fixes");
      await db.execute("ALTER TABLE _pr_review_fixes_v2 RENAME TO pr_review_fixes");
    } else {
      await db.execute("DROP TABLE IF EXISTS _pr_review_fixes_v2");
    }
  } catch {
    // Migration already completed or not needed
    await db.execute("DROP TABLE IF EXISTS _pr_review_fixes_v2").catch(() => {});
  }

  await migratePrReviewStage(db);
}

const RESEARCH_PROMPT = `You are a senior software engineer performing research on a task. Your ONLY job is to investigate and understand — do NOT plan, propose solutions, or discuss implementation approaches.

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
- "High-Level Approaches": Brainstorm and compare multiple approaches (useful for complex tasks with multiple viable solutions)
- "Planning": Create a detailed implementation plan (useful for non-trivial changes)
- "Implementation": Write the actual code changes (almost always needed)
- "Refinement": Self-review the implementation for quality issues (useful for larger changes)
- "Security Review": Check for security vulnerabilities (useful when dealing with auth, user input, APIs, or data handling)
- "PR Preparation": Prepare a pull request with title and description (useful when changes will be submitted as a PR)
- "PR Review": Fetch and address PR reviewer comments after the PR is created (include whenever PR Preparation is selected)

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

const APPROACHES_PROMPT = `You are a senior software architect proposing implementation approaches for a task.

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
}`;

const APPROACHES_SCHEMA = JSON.stringify({
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

const PLANNING_PROMPT = `You are a senior software engineer creating a detailed implementation plan.

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
}`;

const PLANNING_SCHEMA = JSON.stringify({
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

async function migratePrPrepSummaries(db: Database): Promise<void> {
  const rows = await db.select<{ id: string; prompt_template: string }[]>(
    "SELECT id, prompt_template FROM stage_templates WHERE name = 'PR Preparation' AND sort_order = 6",
  );
  for (const row of rows) {
    if (!row.prompt_template.includes("{{stage_summaries}}")) {
      await db.execute(
        "UPDATE stage_templates SET prompt_template = $1, updated_at = $2 WHERE id = $3",
        [
          `Prepare a pull request for the following completed task.

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

Respond with a JSON object:
{
  "fields": {
    "title": "PR title here",
    "description": "PR description here",
    "test_plan": "Test plan here"
  }
}`,
          new Date().toISOString(),
          row.id,
        ],
      );
    }
  }
}

async function migrateInteractiveStages(db: Database): Promise<void> {
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

async function migratePrReviewStage(db: Database): Promise<void> {
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
