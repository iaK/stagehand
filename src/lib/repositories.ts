import { getAppDb, getProjectDb } from "./db";
import { getDefaultStageTemplates } from "./seed";
import type {
  Project,
  StageTemplate,
  Task,
  StageExecution,
  PrReviewFix,
} from "./types";

// === Settings ===

export async function getSetting(key: string): Promise<string | null> {
  const db = await getAppDb();
  const rows = await db.select<{ value: string }[]>(
    "SELECT value FROM settings WHERE key = $1",
    [key],
  );
  return rows[0]?.value ?? null;
}

export async function setSetting(key: string, value: string): Promise<void> {
  const db = await getAppDb();
  await db.execute(
    "INSERT INTO settings (key, value) VALUES ($1, $2) ON CONFLICT(key) DO UPDATE SET value = $2",
    [key, value],
  );
}

export async function deleteSetting(key: string): Promise<void> {
  const db = await getAppDb();
  await db.execute("DELETE FROM settings WHERE key = $1", [key]);
}

// === Per-Project Settings ===

export async function getProjectSetting(projectId: string, key: string): Promise<string | null> {
  const db = await getProjectDb(projectId);
  const rows = await db.select<{ value: string }[]>(
    "SELECT value FROM settings WHERE key = $1",
    [key],
  );
  return rows[0]?.value ?? null;
}

export async function setProjectSetting(projectId: string, key: string, value: string): Promise<void> {
  const db = await getProjectDb(projectId);
  await db.execute(
    "INSERT INTO settings (key, value) VALUES ($1, $2) ON CONFLICT(key) DO UPDATE SET value = $2",
    [key, value],
  );
}

export async function deleteProjectSetting(projectId: string, key: string): Promise<void> {
  const db = await getProjectDb(projectId);
  await db.execute("DELETE FROM settings WHERE key = $1", [key]);
}

// === Projects ===

export async function listProjects(): Promise<Project[]> {
  const db = await getAppDb();
  return db.select<Project[]>(
    "SELECT * FROM projects WHERE archived = 0 ORDER BY updated_at DESC",
  );
}

export async function listArchivedProjects(): Promise<Project[]> {
  const db = await getAppDb();
  return db.select<Project[]>(
    "SELECT * FROM projects WHERE archived = 1 ORDER BY updated_at DESC",
  );
}

export async function createProject(name: string, path: string): Promise<Project> {
  const db = await getAppDb();
  const id = crypto.randomUUID();
  const now = new Date().toISOString();

  await db.execute(
    "INSERT INTO projects (id, name, path, created_at, updated_at) VALUES ($1, $2, $3, $4, $5)",
    [id, name, path, now, now],
  );

  // Initialize project database and seed templates
  const projectDb = await getProjectDb(id);
  const templates = getDefaultStageTemplates(id);
  for (const t of templates) {
    await projectDb.execute(
      `INSERT INTO stage_templates (id, project_id, name, description, sort_order, prompt_template, input_source, output_format, output_schema, gate_rules, persona_name, persona_system_prompt, persona_model, preparation_prompt, allowed_tools, result_mode)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)`,
      [
        t.id, t.project_id, t.name, t.description, t.sort_order,
        t.prompt_template, t.input_source, t.output_format,
        t.output_schema, t.gate_rules, t.persona_name,
        t.persona_system_prompt, t.persona_model, t.preparation_prompt,
        t.allowed_tools, t.result_mode,
      ],
    );
  }

  return { id, name, path, archived: 0, created_at: now, updated_at: now };
}

export async function deleteProject(id: string): Promise<void> {
  const db = await getAppDb();
  await db.execute("DELETE FROM projects WHERE id = $1", [id]);
}

export async function updateProject(
  id: string,
  updates: Partial<Pick<Project, "name" | "archived">>,
): Promise<void> {
  const db = await getAppDb();
  const sets: string[] = [];
  const values: unknown[] = [];
  let idx = 1;

  for (const [key, value] of Object.entries(updates)) {
    sets.push(`${key} = $${idx}`);
    values.push(value);
    idx++;
  }

  sets.push(`updated_at = $${idx}`);
  values.push(new Date().toISOString());
  idx++;

  values.push(id);
  await db.execute(
    `UPDATE projects SET ${sets.join(", ")} WHERE id = $${idx}`,
    values,
  );
}

// === Stage Templates ===

export async function listStageTemplates(
  projectId: string,
): Promise<StageTemplate[]> {
  const db = await getProjectDb(projectId);
  return db.select<StageTemplate[]>(
    "SELECT * FROM stage_templates WHERE project_id = $1 ORDER BY sort_order ASC",
    [projectId],
  );
}

export async function updateStageTemplate(
  projectId: string,
  templateId: string,
  updates: Partial<
    Pick<
      StageTemplate,
      | "name"
      | "description"
      | "prompt_template"
      | "input_source"
      | "output_format"
      | "output_schema"
      | "gate_rules"
      | "sort_order"
      | "allowed_tools"
    >
  >,
): Promise<void> {
  const db = await getProjectDb(projectId);
  const sets: string[] = [];
  const values: unknown[] = [];
  let idx = 1;

  for (const [key, value] of Object.entries(updates)) {
    sets.push(`${key} = $${idx}`);
    values.push(value);
    idx++;
  }

  sets.push(`updated_at = $${idx}`);
  values.push(new Date().toISOString());
  idx++;

  values.push(templateId);
  await db.execute(
    `UPDATE stage_templates SET ${sets.join(", ")} WHERE id = $${idx}`,
    values,
  );
}

// === Tasks ===

export async function listTasks(projectId: string): Promise<Task[]> {
  const db = await getProjectDb(projectId);
  return db.select<Task[]>(
    "SELECT * FROM tasks WHERE project_id = $1 AND archived = 0 ORDER BY created_at DESC",
    [projectId],
  );
}

export async function createTask(
  projectId: string,
  title: string,
  firstStageId: string,
  description: string = "",
  branchName?: string,
  worktreePath?: string,
): Promise<Task> {
  const db = await getProjectDb(projectId);
  const id = crypto.randomUUID();
  const now = new Date().toISOString();

  await db.execute(
    `INSERT INTO tasks (id, project_id, title, description, current_stage_id, status, branch_name, worktree_path, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
    [id, projectId, title, description, firstStageId, "pending", branchName ?? null, worktreePath ?? null, now, now],
  );

  return {
    id,
    project_id: projectId,
    title,
    description,
    current_stage_id: firstStageId,
    status: "pending",
    branch_name: branchName ?? null,
    worktree_path: worktreePath ?? null,
    pr_url: null,
    archived: 0,
    created_at: now,
    updated_at: now,
  };
}

export async function updateTask(
  projectId: string,
  taskId: string,
  updates: Partial<Pick<Task, "current_stage_id" | "status" | "title" | "archived" | "branch_name" | "worktree_path" | "pr_url">>,
): Promise<void> {
  const db = await getProjectDb(projectId);
  const sets: string[] = [];
  const values: unknown[] = [];
  let idx = 1;

  for (const [key, value] of Object.entries(updates)) {
    sets.push(`${key} = $${idx}`);
    values.push(value);
    idx++;
  }

  sets.push(`updated_at = $${idx}`);
  values.push(new Date().toISOString());
  idx++;

  values.push(taskId);
  await db.execute(
    `UPDATE tasks SET ${sets.join(", ")} WHERE id = $${idx}`,
    values,
  );
}

// === Stage Executions ===

export async function getLatestExecutionStatusPerTask(
  projectId: string,
): Promise<Record<string, string>> {
  const db = await getProjectDb(projectId);
  const rows = await db.select<{ task_id: string; status: string }[]>(
    `SELECT se.task_id, se.status FROM stage_executions se
     INNER JOIN (
       SELECT task_id, MAX(started_at) as max_started
       FROM stage_executions
       GROUP BY task_id
     ) latest ON se.task_id = latest.task_id AND se.started_at = latest.max_started`,
    [],
  );
  const result: Record<string, string> = {};
  for (const row of rows) {
    result[row.task_id] = row.status;
  }
  return result;
}

export async function listStageExecutions(
  projectId: string,
  taskId: string,
): Promise<StageExecution[]> {
  const db = await getProjectDb(projectId);
  return db.select<StageExecution[]>(
    "SELECT * FROM stage_executions WHERE task_id = $1 ORDER BY started_at ASC",
    [taskId],
  );
}

export async function getLatestExecution(
  projectId: string,
  taskId: string,
  stageTemplateId: string,
): Promise<StageExecution | null> {
  const db = await getProjectDb(projectId);
  const results = await db.select<StageExecution[]>(
    "SELECT * FROM stage_executions WHERE task_id = $1 AND stage_template_id = $2 ORDER BY attempt_number DESC LIMIT 1",
    [taskId, stageTemplateId],
  );
  return results[0] ?? null;
}

export async function createStageExecution(
  projectId: string,
  execution: Omit<StageExecution, "completed_at">,
): Promise<StageExecution> {
  const db = await getProjectDb(projectId);
  await db.execute(
    `INSERT INTO stage_executions (id, task_id, stage_template_id, attempt_number, status, input_prompt, user_input, raw_output, parsed_output, user_decision, session_id, error_message, thinking_output, stage_result, stage_summary, started_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)`,
    [
      execution.id,
      execution.task_id,
      execution.stage_template_id,
      execution.attempt_number,
      execution.status,
      execution.input_prompt,
      execution.user_input,
      execution.raw_output,
      execution.parsed_output,
      execution.user_decision,
      execution.session_id,
      execution.error_message,
      execution.thinking_output,
      execution.stage_result,
      execution.stage_summary,
      execution.started_at,
    ],
  );

  return { ...execution, completed_at: null };
}

export async function updateStageExecution(
  projectId: string,
  executionId: string,
  updates: Partial<
    Pick<
      StageExecution,
      | "status"
      | "raw_output"
      | "parsed_output"
      | "user_decision"
      | "error_message"
      | "thinking_output"
      | "stage_result"
      | "stage_summary"
      | "completed_at"
    >
  >,
): Promise<void> {
  const db = await getProjectDb(projectId);
  const sets: string[] = [];
  const values: unknown[] = [];
  let idx = 1;

  for (const [key, value] of Object.entries(updates)) {
    sets.push(`${key} = $${idx}`);
    values.push(value);
    idx++;
  }

  values.push(executionId);
  await db.execute(
    `UPDATE stage_executions SET ${sets.join(", ")} WHERE id = $${idx}`,
    values,
  );
}

export async function getExecutionsForStage(
  projectId: string,
  taskId: string,
  stageTemplateId: string,
): Promise<StageExecution[]> {
  const db = await getProjectDb(projectId);
  return db.select<StageExecution[]>(
    "SELECT * FROM stage_executions WHERE task_id = $1 AND stage_template_id = $2 ORDER BY attempt_number ASC",
    [taskId, stageTemplateId],
  );
}

export async function getPreviousStageExecution(
  projectId: string,
  taskId: string,
  currentSortOrder: number,
  stageTemplates: StageTemplate[],
): Promise<StageExecution | null> {
  if (currentSortOrder <= 0) return null;

  const previousTemplate = stageTemplates
    .filter((t) => t.sort_order < currentSortOrder)
    .sort((a, b) => b.sort_order - a.sort_order)[0] ?? null;
  if (!previousTemplate) return null;

  const db = await getProjectDb(projectId);
  const results = await db.select<StageExecution[]>(
    "SELECT * FROM stage_executions WHERE task_id = $1 AND stage_template_id = $2 AND status = 'approved' ORDER BY attempt_number DESC LIMIT 1",
    [taskId, previousTemplate.id],
  );
  return results[0] ?? null;
}

// === Task Stages ===

export async function getTaskStages(
  projectId: string,
  taskId: string,
): Promise<string[]> {
  const db = await getProjectDb(projectId);
  const rows = await db.select<{ stage_template_id: string }[]>(
    "SELECT stage_template_id FROM task_stages WHERE task_id = $1 ORDER BY sort_order ASC",
    [taskId],
  );
  return rows.map((r) => r.stage_template_id);
}

export async function setTaskStages(
  projectId: string,
  taskId: string,
  stages: { stageTemplateId: string; sortOrder: number }[],
): Promise<void> {
  const db = await getProjectDb(projectId);
  await db.execute("DELETE FROM task_stages WHERE task_id = $1", [taskId]);
  for (const s of stages) {
    await db.execute(
      "INSERT INTO task_stages (id, task_id, stage_template_id, sort_order) VALUES ($1, $2, $3, $4)",
      [crypto.randomUUID(), taskId, s.stageTemplateId, s.sortOrder],
    );
  }
}

export async function getFilteredStageTemplates(
  projectId: string,
  taskId: string,
  allTemplates: StageTemplate[],
): Promise<StageTemplate[]> {
  const selectedIds = await getTaskStages(projectId, taskId);
  if (selectedIds.length === 0) return allTemplates;

  const idSet = new Set(selectedIds);
  return allTemplates.filter((t) => idSet.has(t.id));
}

// === PR Review Fixes ===

export async function listPrReviewFixes(
  projectId: string,
  executionId: string,
): Promise<PrReviewFix[]> {
  const db = await getProjectDb(projectId);
  return db.select<PrReviewFix[]>(
    "SELECT * FROM pr_review_fixes WHERE execution_id = $1 ORDER BY created_at ASC",
    [executionId],
  );
}

export async function upsertPrReviewFix(
  projectId: string,
  fix: Omit<PrReviewFix, "created_at" | "updated_at">,
): Promise<void> {
  const db = await getProjectDb(projectId);
  const now = new Date().toISOString();
  await db.execute(
    `INSERT INTO pr_review_fixes (id, execution_id, comment_id, comment_type, author, author_avatar_url, body, file_path, line, diff_hunk, state, fix_status, fix_commit_hash, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
     ON CONFLICT(execution_id, comment_id, comment_type) DO UPDATE SET
       author = $5, author_avatar_url = $6, body = $7, file_path = $8, line = $9,
       diff_hunk = $10, state = $11, updated_at = $15`,
    [
      fix.id,
      fix.execution_id,
      fix.comment_id,
      fix.comment_type,
      fix.author,
      fix.author_avatar_url,
      fix.body,
      fix.file_path,
      fix.line,
      fix.diff_hunk,
      fix.state,
      fix.fix_status,
      fix.fix_commit_hash,
      now,
      now,
    ],
  );
}

export async function updatePrReviewFix(
  projectId: string,
  fixId: string,
  updates: Partial<Pick<PrReviewFix, "fix_status" | "fix_commit_hash" | "state">>,
): Promise<void> {
  const db = await getProjectDb(projectId);
  const sets: string[] = [];
  const values: unknown[] = [];
  let idx = 1;

  for (const [key, value] of Object.entries(updates)) {
    sets.push(`${key} = $${idx}`);
    values.push(value);
    idx++;
  }

  sets.push(`updated_at = $${idx}`);
  values.push(new Date().toISOString());
  idx++;

  values.push(fixId);
  await db.execute(
    `UPDATE pr_review_fixes SET ${sets.join(", ")} WHERE id = $${idx}`,
    values,
  );
}

export async function getApprovedStageSummaries(
  projectId: string,
  taskId: string,
): Promise<{ stage_name: string; stage_summary: string }[]> {
  const db = await getProjectDb(projectId);
  const rows = await db.select<{ stage_name: string; stage_summary: string }[]>(
    `SELECT st.name AS stage_name, se.stage_summary
     FROM stage_executions se
     JOIN stage_templates st ON se.stage_template_id = st.id
     WHERE se.task_id = $1 AND se.status = 'approved' AND se.stage_summary IS NOT NULL AND se.stage_summary != ''
     ORDER BY st.sort_order ASC`,
    [taskId],
  );
  return rows;
}