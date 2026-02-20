import { getAppDb, getProjectDb } from "./db";
import { getDefaultStageTemplates } from "./seed";
import type {
  Project,
  StageTemplate,
  Task,
  StageExecution,
  PrReviewFix,
  CompletionStrategy,
  OutputFormat,
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

export async function getCompletionStrategy(projectId: string): Promise<CompletionStrategy> {
  return (await getProjectSetting(projectId, "default_completion_strategy") ?? "pr") as CompletionStrategy;
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
      `INSERT INTO stage_templates (id, project_id, name, description, sort_order, prompt_template, input_source, output_format, output_schema, gate_rules, persona_name, persona_system_prompt, persona_model, preparation_prompt, allowed_tools, requires_user_input)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)`,
      [
        t.id, t.project_id, t.name, t.description, t.sort_order,
        t.prompt_template, t.input_source, t.output_format,
        t.output_schema, t.gate_rules, t.persona_name,
        t.persona_system_prompt, t.persona_model, t.preparation_prompt,
        t.allowed_tools, t.requires_user_input,
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
      | "persona_system_prompt"
      | "requires_user_input"
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

export async function createStageTemplate(
  projectId: string,
  template: Omit<StageTemplate, "id" | "created_at" | "updated_at">,
): Promise<StageTemplate> {
  const db = await getProjectDb(projectId);
  const id = crypto.randomUUID();
  const now = new Date().toISOString();

  await db.execute(
    `INSERT INTO stage_templates (id, project_id, name, description, sort_order, prompt_template, input_source, output_format, output_schema, gate_rules, persona_name, persona_system_prompt, persona_model, preparation_prompt, allowed_tools, requires_user_input, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)`,
    [
      id, template.project_id, template.name, template.description,
      template.sort_order, template.prompt_template, template.input_source,
      template.output_format, template.output_schema, template.gate_rules,
      template.persona_name, template.persona_system_prompt, template.persona_model,
      template.preparation_prompt, template.allowed_tools,
      template.requires_user_input, now, now,
    ],
  );

  return { id, ...template, created_at: now, updated_at: now };
}

/** Output formats that identify non-deletable "special" stages. */
export const SPECIAL_STAGE_FORMATS: OutputFormat[] = ["research", "pr_preparation", "pr_review", "merge"];

export function isSpecialStage(format: OutputFormat): boolean {
  return (SPECIAL_STAGE_FORMATS as string[]).includes(format);
}

export async function getCommitPrefix(projectId: string): Promise<string> {
  return (await getProjectSetting(projectId, "commit_prefix")) ?? "feat";
}

export async function deleteStageTemplate(
  projectId: string,
  templateId: string,
): Promise<void> {
  const db = await getProjectDb(projectId);

  // Refuse to delete special stages
  const templateRows = await db.select<{ output_format: string }[]>(
    "SELECT output_format FROM stage_templates WHERE id = $1",
    [templateId],
  );
  if (templateRows.length > 0 && isSpecialStage(templateRows[0].output_format as OutputFormat)) {
    throw new Error("Cannot delete special stage");
  }

  // Refuse if active tasks reference this template
  const activeTasks = await db.select<{ cnt: number }[]>(
    `SELECT COUNT(*) as cnt FROM tasks
     WHERE current_stage_id = $1 AND status != 'completed' AND archived = 0`,
    [templateId],
  );
  if (activeTasks[0]?.cnt > 0) {
    throw new Error("Cannot delete stage: active tasks are using it");
  }

  // Refuse if running/awaiting_user executions reference this template
  const activeExecs = await db.select<{ cnt: number }[]>(
    `SELECT COUNT(*) as cnt FROM stage_executions
     WHERE stage_template_id = $1 AND status IN ('running', 'awaiting_user')`,
    [templateId],
  );
  if (activeExecs[0]?.cnt > 0) {
    throw new Error("Cannot delete stage: it has running or pending executions");
  }

  await db.execute("DELETE FROM stage_templates WHERE id = $1", [templateId]);
}

export async function reorderStageTemplates(
  projectId: string,
  orderedIds: string[],
): Promise<void> {
  const db = await getProjectDb(projectId);
  const now = new Date().toISOString();
  for (let i = 0; i < orderedIds.length; i++) {
    await db.execute(
      "UPDATE stage_templates SET sort_order = $1, updated_at = $2 WHERE id = $3",
      [(i + 1) * 100, now, orderedIds[i]],
    );
  }
}

export async function duplicateStageTemplate(
  projectId: string,
  templateId: string,
): Promise<StageTemplate> {
  const db = await getProjectDb(projectId);
  const rows = await db.select<StageTemplate[]>(
    "SELECT * FROM stage_templates WHERE id = $1",
    [templateId],
  );
  if (rows.length === 0) throw new Error("Template not found");

  const source = rows[0];
  const id = crypto.randomUUID();
  const now = new Date().toISOString();

  // Find the next template's sort_order to place the copy between source and next
  const nextRows = await db.select<{ sort_order: number }[]>(
    "SELECT sort_order FROM stage_templates WHERE project_id = $1 AND sort_order > $2 ORDER BY sort_order ASC LIMIT 1",
    [projectId, source.sort_order],
  );
  const nextOrder = nextRows.length > 0 ? nextRows[0].sort_order : source.sort_order + 100;
  const newOrder = Math.floor((source.sort_order + nextOrder) / 2);

  // If there's no room (adjacent integers), shift everything after up by 100
  if (newOrder === source.sort_order) {
    await db.execute(
      "UPDATE stage_templates SET sort_order = sort_order + 100, updated_at = $1 WHERE project_id = $2 AND sort_order > $3",
      [now, projectId, source.sort_order],
    );
  }
  const finalOrder = newOrder === source.sort_order ? source.sort_order + 50 : newOrder;

  const newTemplate: StageTemplate = {
    ...source,
    id,
    name: `${source.name} (Copy)`,
    sort_order: finalOrder,
    created_at: now,
    updated_at: now,
  };

  await db.execute(
    `INSERT INTO stage_templates (id, project_id, name, description, sort_order, prompt_template, input_source, output_format, output_schema, gate_rules, persona_name, persona_system_prompt, persona_model, preparation_prompt, allowed_tools, requires_user_input, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)`,
    [
      newTemplate.id, newTemplate.project_id, newTemplate.name, newTemplate.description,
      newTemplate.sort_order, newTemplate.prompt_template, newTemplate.input_source,
      newTemplate.output_format, newTemplate.output_schema, newTemplate.gate_rules,
      newTemplate.persona_name, newTemplate.persona_system_prompt, newTemplate.persona_model,
      newTemplate.preparation_prompt, newTemplate.allowed_tools,
      newTemplate.requires_user_input, now, now,
    ],
  );

  return newTemplate;
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
    `INSERT INTO stage_executions (id, task_id, stage_template_id, attempt_number, status, input_prompt, user_input, raw_output, parsed_output, user_decision, session_id, error_message, thinking_output, stage_result, stage_summary, input_tokens, output_tokens, cache_creation_input_tokens, cache_read_input_tokens, total_cost_usd, duration_ms, num_turns, started_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23)`,
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
      execution.input_tokens,
      execution.output_tokens,
      execution.cache_creation_input_tokens,
      execution.cache_read_input_tokens,
      execution.total_cost_usd,
      execution.duration_ms,
      execution.num_turns,
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
      | "input_tokens"
      | "output_tokens"
      | "cache_creation_input_tokens"
      | "cache_read_input_tokens"
      | "total_cost_usd"
      | "duration_ms"
      | "num_turns"
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

export async function getProjectTaskSummary(
  projectId: string,
): Promise<{ taskStatuses: string[]; execStatuses: string[] }> {
  const db = await getProjectDb(projectId);

  const [tasks, execRows] = await Promise.all([
    db.select<{ status: string }[]>(
      "SELECT status FROM tasks WHERE project_id = $1 AND archived = 0",
      [projectId],
    ),
    db.select<{ status: string }[]>(
      `SELECT se.status FROM stage_executions se
       INNER JOIN (
         SELECT task_id, MAX(started_at) as max_started
         FROM stage_executions GROUP BY task_id
       ) latest ON se.task_id = latest.task_id AND se.started_at = latest.max_started
       INNER JOIN tasks t ON t.id = se.task_id AND t.project_id = $1 AND t.archived = 0`,
      [projectId],
    ),
  ]);

  return {
    taskStatuses: tasks.map((t) => t.status),
    execStatuses: execRows.map((e) => e.status),
  };
}

export async function getApprovedStageOutputs(
  projectId: string,
  taskId: string,
): Promise<{ stage_name: string; stage_result: string; stage_summary: string }[]> {
  const db = await getProjectDb(projectId);
  return db.select<{ stage_name: string; stage_result: string; stage_summary: string }[]>(
    `SELECT st.name AS stage_name, se.stage_result, se.stage_summary
     FROM stage_executions se
     JOIN stage_templates st ON se.stage_template_id = st.id
     WHERE se.task_id = $1 AND se.status = 'approved' AND se.stage_result IS NOT NULL AND se.stage_result != ''
     ORDER BY st.sort_order ASC`,
    [taskId],
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