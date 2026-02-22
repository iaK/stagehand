pub struct AgentConfig {
    pub command: &'static str,
    pub display_name: &'static str,
    pub prompt_flag: &'static str,
    pub output_format_flag: &'static str,
    pub system_prompt_flag: &'static str,
    pub skip_permissions_flag: &'static str,
    pub version_flag: &'static str,
}

pub const CLAUDE_CONFIG: AgentConfig = AgentConfig {
    command: "claude",
    display_name: "Claude",
    prompt_flag: "-p",
    output_format_flag: "--output-format",
    system_prompt_flag: "--append-system-prompt",
    skip_permissions_flag: "--dangerously-skip-permissions",
    version_flag: "--version",
};

pub fn get_agent_config(_name: &str) -> &'static AgentConfig {
    &CLAUDE_CONFIG
}
