import type Database from "@tauri-apps/plugin-sql";
import { runPendingMigrations } from "./migrations";

export async function initAppSchema(db: Database): Promise<void> {
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

export async function initProjectSchema(db: Database): Promise<void> {
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

  // Incremental schema additions (idempotent via .catch)
  await db.execute(`ALTER TABLE stage_executions ADD COLUMN user_input TEXT`).catch(() => {});
  await db.execute(`ALTER TABLE stage_executions ADD COLUMN thinking_output TEXT`).catch(() => {});
  await db.execute(`ALTER TABLE stage_executions ADD COLUMN stage_result TEXT`).catch(() => {});
  await db.execute(`ALTER TABLE stage_templates ADD COLUMN result_mode TEXT NOT NULL DEFAULT 'replace'`).catch(() => {});
  await db.execute(`ALTER TABLE stage_executions ADD COLUMN stage_summary TEXT`).catch(() => {});
  await db.execute(`ALTER TABLE stage_executions ADD COLUMN input_tokens INTEGER`).catch(() => {});
  await db.execute(`ALTER TABLE stage_executions ADD COLUMN output_tokens INTEGER`).catch(() => {});
  await db.execute(`ALTER TABLE stage_executions ADD COLUMN cache_creation_input_tokens INTEGER`).catch(() => {});
  await db.execute(`ALTER TABLE stage_executions ADD COLUMN cache_read_input_tokens INTEGER`).catch(() => {});
  await db.execute(`ALTER TABLE stage_executions ADD COLUMN total_cost_usd REAL`).catch(() => {});
  await db.execute(`ALTER TABLE stage_executions ADD COLUMN duration_ms INTEGER`).catch(() => {});
  await db.execute(`ALTER TABLE stage_executions ADD COLUMN num_turns INTEGER`).catch(() => {});
  await db.execute(`ALTER TABLE tasks ADD COLUMN branch_name TEXT`).catch(() => {});
  await db.execute(`ALTER TABLE tasks ADD COLUMN pr_url TEXT`).catch(() => {});
  await db.execute(`ALTER TABLE tasks ADD COLUMN worktree_path TEXT`).catch(() => {});
  await db.execute(`ALTER TABLE tasks ADD COLUMN ejected INTEGER NOT NULL DEFAULT 0`).catch(() => {});

  // Vestigial: completion_strategy was moved to a project-level setting
  await db.execute(`ALTER TABLE tasks ADD COLUMN completion_strategy TEXT NOT NULL DEFAULT 'pr'`).catch(() => {});

  // Add behavior flag columns to stage_templates
  await db.execute(`ALTER TABLE stage_templates ADD COLUMN commits_changes INTEGER NOT NULL DEFAULT 0`).catch(() => {});
  await db.execute(`ALTER TABLE stage_templates ADD COLUMN creates_pr INTEGER NOT NULL DEFAULT 0`).catch(() => {});
  await db.execute(`ALTER TABLE stage_templates ADD COLUMN is_terminal INTEGER NOT NULL DEFAULT 0`).catch(() => {});
  await db.execute(`ALTER TABLE stage_templates ADD COLUMN triggers_stage_selection INTEGER NOT NULL DEFAULT 0`).catch(() => {});
  await db.execute(`ALTER TABLE stage_templates ADD COLUMN commit_prefix TEXT`).catch(() => {});

  // Add requires_user_input column
  await db.execute(`ALTER TABLE stage_templates ADD COLUMN requires_user_input INTEGER NOT NULL DEFAULT 0`).catch(() => {});

  // Add agent column
  await db.execute(`ALTER TABLE stage_templates ADD COLUMN agent TEXT`).catch(() => {});
  await db.execute(`UPDATE stage_templates SET requires_user_input = 1 WHERE input_source IN ('user', 'both') AND requires_user_input = 0`).catch(() => {});

  // Migrate old completion strategy values
  await db.execute("UPDATE settings SET value = 'merge' WHERE key = 'default_completion_strategy' AND value = 'direct_merge'").catch(() => {});
  await db.execute("UPDATE settings SET value = 'pr' WHERE key = 'default_completion_strategy' AND value = 'none'").catch(() => {});

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

  // Run version-tracked migrations
  await runPendingMigrations(db);
}
