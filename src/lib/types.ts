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
  result_mode: ResultMode;
  created_at: string;
  updated_at: string;
}

export type InputSource = "user" | "previous_stage" | "both";
export type OutputFormat = "text" | "options" | "checklist" | "structured" | "research" | "findings";
export type ResultMode = "replace" | "append" | "passthrough";

export interface Task {
  id: string;
  project_id: string;
  title: string;
  description: string;
  current_stage_id: string | null;
  status: TaskStatus;
  branch_name: string | null;
  archived: number;
  created_at: string;
  updated_at: string;
}

export type TaskStatus = "pending" | "in_progress" | "completed" | "failed";

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

export interface ResearchQuestion {
  id: string;
  question: string;
  proposed_answer: string;
  options?: string[];
}

export interface ResearchOutput {
  research: string;
  questions: ResearchQuestion[];
}

// === GitHub ===

export interface GitHubRepo {
  id: number;
  full_name: string;       // "owner/repo"
  name: string;
  owner: string;
  description: string | null;
  default_branch: string;
  private: boolean;
  html_url: string;
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
}
