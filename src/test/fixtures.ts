import type {
  Project,
  Task,
  StageTemplate,
  StageExecution,
} from "../lib/types";

export function makeProject(overrides?: Partial<Project>): Project {
  return {
    id: crypto.randomUUID(),
    name: "Test Project",
    path: "/tmp/test-project",
    archived: 0,
    created_at: "2025-01-01T00:00:00.000Z",
    updated_at: "2025-01-01T00:00:00.000Z",
    ...overrides,
  };
}

export function makeTask(overrides?: Partial<Task>): Task {
  return {
    id: crypto.randomUUID(),
    project_id: "project-1",
    title: "Test Task",
    description: "A test task description",
    current_stage_id: "stage-1",
    status: "pending",
    branch_name: null,
    worktree_path: null,
    pr_url: null,
    archived: 0,
    created_at: "2025-01-01T00:00:00.000Z",
    updated_at: "2025-01-01T00:00:00.000Z",
    ...overrides,
  };
}

export function makeStageTemplate(
  overrides?: Partial<StageTemplate>,
): StageTemplate {
  return {
    id: crypto.randomUUID(),
    project_id: "project-1",
    name: "Test Stage",
    description: "A test stage",
    sort_order: 0,
    prompt_template: "Do something with {{task_description}}",
    input_source: "user",
    output_format: "text",
    output_schema: null,
    gate_rules: JSON.stringify({ type: "require_approval" }),
    persona_name: null,
    persona_system_prompt: null,
    persona_model: null,
    preparation_prompt: null,
    allowed_tools: null,
    result_mode: "replace",
    commits_changes: 0,
    creates_pr: 0,
    is_terminal: 0,
    triggers_stage_selection: 0,
    commit_prefix: null,
    created_at: "2025-01-01T00:00:00.000Z",
    updated_at: "2025-01-01T00:00:00.000Z",
    ...overrides,
  };
}

export function makeStageExecution(
  overrides?: Partial<StageExecution>,
): StageExecution {
  return {
    id: crypto.randomUUID(),
    task_id: "task-1",
    stage_template_id: "stage-1",
    attempt_number: 1,
    status: "approved",
    input_prompt: "test prompt",
    user_input: null,
    raw_output: null,
    parsed_output: null,
    user_decision: null,
    session_id: null,
    error_message: null,
    thinking_output: null,
    stage_result: null,
    stage_summary: null,
    input_tokens: null,
    output_tokens: null,
    cache_creation_input_tokens: null,
    cache_read_input_tokens: null,
    total_cost_usd: null,
    duration_ms: null,
    num_turns: null,
    started_at: "2025-01-01T00:00:00.000Z",
    completed_at: "2025-01-01T00:01:00.000Z",
    ...overrides,
  };
}

