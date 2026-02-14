import { getAppDb, getProjectDb } from "./db";
import { getDefaultStageTemplates } from "./seed";
import type {
  Project,
  StageTemplate,
  Task,
  StageExecution,
} from "./types";

// === Projects ===

export async function listProjects(): Promise<Project[]> {
  const db = await getAppDb();
  return db.select<Project[]>(
    "SELECT * FROM projects ORDER BY updated_at DESC",
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
      `INSERT INTO stage_templates (id, project_id, name, description, sort_order, prompt_template, input_source, output_format, output_schema, gate_rules, persona_name, persona_system_prompt, persona_model, preparation_prompt, allowed_tools)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)`,
      [
        t.id, t.project_id, t.name, t.description, t.sort_order,
        t.prompt_template, t.input_source, t.output_format,
        t.output_schema, t.gate_rules, t.persona_name,
        t.persona_system_prompt, t.persona_model, t.preparation_prompt,
        t.allowed_tools,
      ],
    );
  }

  return { id, name, path, created_at: now, updated_at: now };
}

export async function deleteProject(id: string): Promise<void> {
  const db = await getAppDb();
  await db.execute("DELETE FROM projects WHERE id = $1", [id]);
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
): Promise<Task> {
  const db = await getProjectDb(projectId);
  const id = crypto.randomUUID();
  const now = new Date().toISOString();

  await db.execute(
    `INSERT INTO tasks (id, project_id, title, current_stage_id, status, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [id, projectId, title, firstStageId, "pending", now, now],
  );

  return {
    id,
    project_id: projectId,
    title,
    current_stage_id: firstStageId,
    status: "pending",
    archived: 0,
    created_at: now,
    updated_at: now,
  };
}

export async function updateTask(
  projectId: string,
  taskId: string,
  updates: Partial<Pick<Task, "current_stage_id" | "status" | "title" | "archived">>,
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
    `INSERT INTO stage_executions (id, task_id, stage_template_id, attempt_number, status, input_prompt, user_input, raw_output, parsed_output, user_decision, session_id, error_message, thinking_output, started_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
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

  const previousTemplate = stageTemplates.find(
    (t) => t.sort_order === currentSortOrder - 1,
  );
  if (!previousTemplate) return null;

  const db = await getProjectDb(projectId);
  const results = await db.select<StageExecution[]>(
    "SELECT * FROM stage_executions WHERE task_id = $1 AND stage_template_id = $2 AND status = 'approved' ORDER BY attempt_number DESC LIMIT 1",
    [taskId, previousTemplate.id],
  );
  return results[0] ?? null;
}
