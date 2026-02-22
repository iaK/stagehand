export const AVAILABLE_AGENTS = [
  { value: "claude", label: "Claude", description: "Full feature support" },
  { value: "codex", label: "Codex", description: "Uses 'codex exec'. No JSON schema, no system prompt append, no MCP." },
  { value: "gemini", label: "Gemini", description: "No JSON schema, no system prompt append, no MCP." },
  { value: "amp", label: "AMP", description: "No JSON schema, no system prompt append, no MCP." },
  { value: "opencode", label: "OpenCode", description: "No JSON schema, no system prompt, no MCP." },
] as const;

export type AgentValue = (typeof AVAILABLE_AGENTS)[number]["value"];
