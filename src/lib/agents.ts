export const AVAILABLE_AGENTS = [
  { value: "claude", label: "Claude", description: "Full feature support", supportsJsonSchema: true, hidden: false },
  { value: "codex", label: "Codex", description: "Uses 'codex exec'. Supports JSON schema, system prompt, and MCP.", supportsJsonSchema: true, hidden: false },
  { value: "gemini", label: "Gemini", description: "Supports JSON output, MCP. System prompt replacement only (no append).", supportsJsonSchema: false, hidden: true },
  { value: "amp", label: "AMP", description: "No JSON schema, no system prompt append, no MCP.", supportsJsonSchema: false, hidden: true },
  { value: "opencode", label: "OpenCode", description: "No JSON schema, no system prompt, no MCP.", supportsJsonSchema: false, hidden: true },
] as const;

export type AgentValue = (typeof AVAILABLE_AGENTS)[number]["value"];
