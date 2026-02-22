export const AVAILABLE_AGENTS = [
  { value: "claude", label: "Claude", description: "Full feature support" },
  { value: "codex", label: "Codex", description: "Uses 'codex exec'. Supports JSON schema, system prompt, and MCP." },
  { value: "gemini", label: "Gemini", description: "Supports JSON output, MCP. System prompt replacement only (no append)." },
  { value: "amp", label: "AMP", description: "No JSON schema, no system prompt append, no MCP." },
  { value: "opencode", label: "OpenCode", description: "No JSON schema, no system prompt, no MCP." },
] as const;

export type AgentValue = (typeof AVAILABLE_AGENTS)[number]["value"];
