export const AVAILABLE_AGENTS = [
  { value: "claude", label: "Claude", description: "Full feature support", supportsJsonSchema: true, hidden: false, defaultModels: ["claude-sonnet-4-5-20250514", "claude-opus-4-20250514", "claude-haiku-4-5-20251001"] },
  { value: "codex", label: "Codex", description: "Uses 'codex exec'. Supports JSON schema, system prompt, and MCP.", supportsJsonSchema: true, hidden: false, defaultModels: ["o3", "o4-mini", "gpt-4.1", "gpt-5", "gpt-5.2", "gpt-5-mini"] },
  { value: "gemini", label: "Gemini", description: "Supports JSON output, MCP. System prompt replacement only (no append).", supportsJsonSchema: false, hidden: true, defaultModels: ["gemini-2.5-pro"] },
  { value: "amp", label: "AMP", description: "No JSON schema, no system prompt append, no MCP.", supportsJsonSchema: false, hidden: true, defaultModels: [] },
  { value: "opencode", label: "OpenCode", description: "No JSON schema, no system prompt, no MCP.", supportsJsonSchema: false, hidden: true, defaultModels: [] },
] as const;

export type AgentValue = (typeof AVAILABLE_AGENTS)[number]["value"];
