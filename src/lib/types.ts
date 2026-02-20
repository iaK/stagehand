// === Core Entities ===

export interface Project {
  id: string;
  name: string;
  path: string;
  archived: number;
  created_at: string;
  updated_at: string;
}

export interface StageTemplate {
  id: string;
  project_id: string;
  name: string;
  description: string;
  sort_order: number;
  prompt_template: string;
  input_source: InputSource;
  output_format: OutputFormat;
  output_schema: string | null; // JSON string
  gate_rules: string; // JSON string of GateRule
  persona_name: string | null;
  persona_system_prompt: string | null;
  persona_model: string | null;
  preparation_prompt: string | null;
  allowed_tools: string | null; // JSON array of tool names
  requires_user_input: number; // boolean: stage needs user input before running (shows input box)
  created_at: string;
  updated_at: string;
}

export type InputSource = "user" | "previous_stage" | "both";
export type OutputFormat = "text" | "options" | "checklist" | "structured" | "research" | "findings" | "plan" | "pr_preparation" | "pr_review" | "merge" | "task_splitting" | "auto";

export interface Task {
  id: string;
  project_id: string;
  title: string;
  description: string;
  current_stage_id: string | null;
  status: TaskStatus;
  branch_name: string | null;
  worktree_path: string | null;
  pr_url: string | null;
  parent_task_id: string | null;
  ejected: number;
  archived: number;
  created_at: string;
  updated_at: string;
}

export type TaskStatus = "pending" | "in_progress" | "completed" | "failed" | "split";

export type CompletionStrategy = "pr" | "merge";

export interface StageExecution {
  id: string;
  task_id: string;
  stage_template_id: string;
  attempt_number: number;
  status: ExecutionStatus;
  input_prompt: string;
  user_input: string | null;
  raw_output: string | null;
  parsed_output: string | null; // JSON string
  user_decision: string | null; // JSON string
  session_id: string | null;
  error_message: string | null;
  thinking_output: string | null;
  stage_result: string | null;
  stage_summary: string | null;
  input_tokens: number | null;
  output_tokens: number | null;
  cache_creation_input_tokens: number | null;
  cache_read_input_tokens: number | null;
  total_cost_usd: number | null;
  duration_ms: number | null;
  num_turns: number | null;
  started_at: string;
  completed_at: string | null;
}

export type ExecutionStatus =
  | "pending"
  | "running"
  | "awaiting_user"
  | "approved"
  | "failed";

// === Gate Rules ===

export type GateRule =
  | { type: "require_approval" }
  | { type: "require_selection"; min: number; max: number }
  | { type: "require_all_checked" }
  | { type: "require_fields"; fields: string[] };

// === Output Types ===

export interface OptionItem {
  id: string;
  title: string;
  description: string;
  pros: string[];
  cons: string[];
}

export interface OptionsOutput {
  options: OptionItem[];
}

export interface ChecklistItem {
  id: string;
  text: string;
  severity: "critical" | "warning" | "info";
  checked: boolean;
  notes: string;
}

export interface ChecklistOutput {
  items: ChecklistItem[];
}

export interface StructuredOutput {
  fields: Record<string, string>;
}

export interface FindingItem {
  id: string;
  title: string;
  description: string;
  severity: "critical" | "warning" | "info";
  category?: string;
  file_path?: string;
  selected: boolean;
}

export interface FindingsOutput {
  summary: string;
  findings: FindingItem[];
}

export interface ProposedSubtask {
  id: string;
  title: string;
  description: string;
  selected: boolean;
}

export interface TaskSplittingOutput {
  reasoning: string;
  proposed_tasks: ProposedSubtask[];
}

export interface ResearchQuestion {
  id: string;
  question: string;
  proposed_answer: string;
  options?: string[];
}

export interface ResearchOutput {
  research: string;
  questions: ResearchQuestion[];
  suggested_stages?: StageSuggestion[];
}

export interface StageSuggestion {
  name: string;
  reason: string;
}

// === PR Review ===

export interface PrReviewFix {
  id: string;
  execution_id: string;
  comment_id: number;
  comment_type: "review" | "inline" | "conversation";
  author: string;
  author_avatar_url: string | null;
  body: string;
  file_path: string | null;
  line: number | null;
  diff_hunk: string | null;
  state: string;
  fix_status: "pending" | "fixing" | "fixed" | "skipped";
  fix_commit_hash: string | null;
  created_at: string;
  updated_at: string;
}

// === Linear ===

export interface LinearIssue {
  id: string;
  identifier: string; // e.g. "ENG-123"
  title: string;
  description: string | undefined;
  status: string;
  priority: number;
  url: string;
  branchName: string | undefined;
}

// === Claude Stream Events ===

export type ClaudeStreamEvent =
  | { type: "started"; process_id: string; session_id: string | null }
  | { type: "stdout_line"; line: string }
  | { type: "stderr_line"; line: string }
  | { type: "completed"; process_id: string; exit_code: number | null }
  | { type: "error"; process_id: string; message: string };

// === Spawn Args ===

export interface SpawnClaudeArgs {
  prompt: string;
  workingDirectory?: string;
  sessionId?: string;
  stageExecutionId?: string;
  appendSystemPrompt?: string;
  jsonSchema?: string;
  outputFormat?: string;
  noSessionPersistence?: boolean;
  allowedTools?: string[];
  maxTurns?: number;
  mcpConfig?: string;
}
