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

    /// Returns the CLI flag to bypass approval prompts, or None if the agent
    /// uses a different mechanism (e.g. environment variable).
    pub fn auto_approve_flag(&self) -> Option<&'static str> {
        match self {
            Agent::Claude => Some("--dangerously-skip-permissions"),
            Agent::Codex => Some("--dangerously-bypass-approvals-and-sandbox"),
            Agent::Gemini => Some("--yolo"),
            Agent::Amp => Some("--dangerously-allow-all"),
            Agent::OpenCode => None, // auto-approval via environment variable, not a CLI flag
        }
    }
}
