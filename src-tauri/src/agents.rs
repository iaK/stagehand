/// Supported AI coding agents.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Agent {
    Claude,
    Codex,
    Gemini,
    Amp,
    OpenCode,
}

impl Agent {
    /// Parse a string into an Agent, returning None for unrecognised values.
    pub fn from_str_opt(s: &str) -> Option<Agent> {
        match s.to_lowercase().as_str() {
            "claude" => Some(Agent::Claude),
            "codex" => Some(Agent::Codex),
            "gemini" => Some(Agent::Gemini),
            "amp" => Some(Agent::Amp),
            "opencode" => Some(Agent::OpenCode),
            _ => None,
        }
    }

    /// The CLI binary name for this agent.
    pub fn binary(&self) -> &str {
        match self {
            Agent::Claude => "claude",
            Agent::Codex => "codex",
            Agent::Gemini => "gemini",
            Agent::Amp => "amp",
            Agent::OpenCode => "opencode",
        }
    }

    /// The flag that skips interactive permission prompts, if the agent supports one.
    pub fn auto_approve_flag(&self) -> Option<&str> {
        match self {
            Agent::Claude => Some("--dangerously-skip-permissions"),
            Agent::Codex => Some("--dangerously-bypass-approvals-and-sandbox"),
            Agent::Gemini => Some("--yolo"),
            Agent::Amp => Some("--dangerously-allow-all"),
            Agent::OpenCode => None,
        }
    }

    /// Whether this agent supports `--session-id`.
    pub fn supports_session_id(&self) -> bool {
        matches!(self, Agent::Claude)
    }

    /// Whether this agent supports `--json-schema`.
    pub fn supports_json_schema(&self) -> bool {
        matches!(self, Agent::Claude)
    }

    /// Whether this agent supports `--append-system-prompt`.
    pub fn supports_append_system_prompt(&self) -> bool {
        !matches!(self, Agent::OpenCode)
    }

    /// Whether this agent supports `--mcp-config`.
    pub fn supports_mcp_config(&self) -> bool {
        matches!(self, Agent::Claude)
    }

    /// Whether this agent supports `--no-session-persistence`.
    pub fn supports_no_session_persistence(&self) -> bool {
        matches!(self, Agent::Claude)
    }

    /// Whether this agent supports `--allowedTools`.
    pub fn supports_allowed_tools(&self) -> bool {
        matches!(self, Agent::Claude)
    }

    /// Whether this agent supports `--max-turns`.
    pub fn supports_max_turns(&self) -> bool {
        matches!(self, Agent::Claude)
    }

    /// Whether this agent supports `--verbose`.
    pub fn supports_verbose(&self) -> bool {
        matches!(self, Agent::Claude)
    }
}
