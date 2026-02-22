export const AVAILABLE_AGENTS = [
  { value: "claude", label: "Claude", description: "Full feature support" },
  { value: "codex", label: "Codex", description: "Uses 'codex exec' — no system prompt, no inline JSON schema" },
  { value: "gemini", label: "Gemini", description: "No JSON schema, no system prompt append" },
  { value: "amp", label: "AMP", description: "No JSON schema, no system prompt append" },
  { value: "opencode", label: "OpenCode", description: "No JSON schema, no system prompt, no MCP" },
] as const;
