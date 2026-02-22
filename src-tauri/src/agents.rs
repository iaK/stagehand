/// Agent enum encapsulating CLI knowledge for each supported AI agent.
#[derive(Debug, Clone, Copy, Default)]
pub enum Agent {
    #[default]
    Claude,
    Codex,
    Gemini,
    Amp,
    OpenCode,
}

impl Agent {
    pub fn from_str_opt(s: Option<&str>) -> Self {
        match s {
            Some("codex") => Agent::Codex,
            Some("gemini") => Agent::Gemini,
            Some("amp") => Agent::Amp,
            Some("opencode") => Agent::OpenCode,
            _ => Agent::Claude,
        }
    }

    pub fn binary(&self) -> &str {
        match self {
            Agent::Claude => "claude",
            Agent::Codex => "codex",
            Agent::Gemini => "gemini",
            Agent::Amp => "amp",
            Agent::OpenCode => "opencode",
        }
    }

    pub fn auto_approve_flag(&self) -> &str {
        match self {
            Agent::Claude => "--dangerously-skip-permissions",
            Agent::Codex => "--dangerously-bypass-approvals-and-sandbox",
            Agent::Gemini => "--yolo",
            Agent::Amp => "--dangerously-allow-all",
            Agent::OpenCode => "--dangerously-skip-permissions",
        }
    }

    pub fn supports_system_prompt(&self) -> bool {
        matches!(self, Agent::Claude)
    }

    pub fn supports_json_schema(&self) -> bool {
        matches!(self, Agent::Claude)
    }

    pub fn supports_allowed_tools(&self) -> bool {
        matches!(self, Agent::Claude)
    }

    pub fn supports_mcp_config(&self) -> bool {
        matches!(self, Agent::Claude | Agent::Amp)
    }

    pub fn supports_session_id(&self) -> bool {
        matches!(self, Agent::Claude | Agent::OpenCode)
    }

    pub fn supports_max_turns(&self) -> bool {
        matches!(self, Agent::Claude)
    }
}
