use crate::agents::Agent;
use crate::events::AgentStreamEvent;
use crate::process_manager::ProcessManager;
use serde::Deserialize;
use std::path::{Path, PathBuf};
use tauri::ipc::Channel;
use tauri::State;
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::Command;

/// Temporary directory context for a spawned agent process.
/// Creates `~/.devflow/tmp/<process_id>/` for temp files (system prompt files,
/// schema files, config files) and tracks working-directory files that need
/// cleanup after the process exits.
struct TempContext {
    /// The per-process temp directory under ~/.devflow/tmp/
    dir: PathBuf,
    /// Files written into the agent's working directory that must be cleaned up.
    workdir_files: Vec<PathBuf>,
}

impl TempContext {
    fn new(process_id: &str) -> Result<Self, String> {
        let home = dirs::home_dir().ok_or("Could not find home directory")?;
        let dir = home.join(".devflow").join("tmp").join(process_id);
        std::fs::create_dir_all(&dir)
            .map_err(|e| format!("Failed to create temp dir {:?}: {}", dir, e))?;
        Ok(Self {
            dir,
            workdir_files: Vec::new(),
        })
    }

    /// Write a file into the per-process temp directory. Returns the full path.
    fn write_temp_file(&self, name: &str, content: &str) -> Result<PathBuf, String> {
        let path = self.dir.join(name);
        std::fs::write(&path, content)
            .map_err(|e| format!("Failed to write temp file {:?}: {}", path, e))?;
        Ok(path)
    }

    /// Write a file into the working directory and track it for cleanup.
    fn write_workdir_file(&mut self, workdir: &Path, relative_path: &str, content: &str) -> Result<PathBuf, String> {
        let path = workdir.join(relative_path);
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)
                .map_err(|e| format!("Failed to create dir {:?}: {}", parent, e))?;
        }
        std::fs::write(&path, content)
            .map_err(|e| format!("Failed to write workdir file {:?}: {}", path, e))?;
        self.workdir_files.push(path.clone());
        Ok(path)
    }

    /// Clean up all temp files and directories.
    fn cleanup(self) {
        // Remove working directory files
        for path in &self.workdir_files {
            let _ = std::fs::remove_file(path);
            // Try to remove parent dir if empty (e.g. .codex/ or .gemini/)
            if let Some(parent) = path.parent() {
                let _ = std::fs::remove_dir(parent);
            }
        }
        // Remove the per-process temp directory
        let _ = std::fs::remove_dir_all(&self.dir);
    }
}

/// Convert Claude-format MCP config JSON to Codex `.codex/config.toml` format.
///
/// Input (Claude format):
/// ```json
/// {"mcpServers":{"name":{"command":"node","args":["path"],"env":{"K":"V"}}}}
/// ```
///
/// Output (Codex TOML):
/// ```toml
/// [[mcp_servers]]
/// name = "name"
/// command = "node"
/// args = ["path"]
/// env = { K = "V" }
/// ```
fn convert_mcp_json_to_codex_toml(mcp_json: &str) -> Result<String, String> {
    let parsed: serde_json::Value =
        serde_json::from_str(mcp_json).map_err(|e| format!("Invalid MCP JSON: {}", e))?;

    let servers = parsed
        .get("mcpServers")
        .and_then(|v| v.as_object())
        .ok_or("MCP JSON missing mcpServers object")?;

    let mut toml = String::new();
    for (name, config) in servers {
        toml.push_str("[[mcp_servers]]\n");
        toml.push_str(&format!("name = {:?}\n", name));

        if let Some(command) = config.get("command").and_then(|v| v.as_str()) {
            toml.push_str(&format!("command = {:?}\n", command));
        }

        if let Some(args) = config.get("args").and_then(|v| v.as_array()) {
            let args_str: Vec<String> = args
                .iter()
                .filter_map(|a| a.as_str())
                .map(|a| format!("{:?}", a))
                .collect();
            toml.push_str(&format!("args = [{}]\n", args_str.join(", ")));
        }

        if let Some(env) = config.get("env").and_then(|v| v.as_object()) {
            if !env.is_empty() {
                let pairs: Vec<String> = env
                    .iter()
                    .map(|(k, v)| {
                        let val = v.as_str().unwrap_or("");
                        format!("{} = {:?}", k, val)
                    })
                    .collect();
                toml.push_str(&format!("env = {{ {} }}\n", pairs.join(", ")));
            }
        }

        toml.push('\n');
    }

    Ok(toml)
}

/// Convert Claude-format MCP config JSON to Gemini `.gemini/settings.json` format.
///
/// Input (Claude format):
/// ```json
/// {"mcpServers":{"name":{"command":"node","args":["path"],"env":{"K":"V"}}}}
/// ```
///
/// Output (Gemini settings.json):
/// ```json
/// {"mcpServers":{"name":{"command":"node","args":["path"],"env":{"K":"V"}}}}
/// ```
///
/// Gemini uses the same format as Claude, so this is essentially a pass-through
/// but we validate and re-serialize to ensure correctness.
fn convert_mcp_json_to_gemini_settings(mcp_json: &str) -> Result<String, String> {
    let parsed: serde_json::Value =
        serde_json::from_str(mcp_json).map_err(|e| format!("Invalid MCP JSON: {}", e))?;

    // Verify structure
    parsed
        .get("mcpServers")
        .and_then(|v| v.as_object())
        .ok_or("MCP JSON missing mcpServers object")?;

    // Gemini uses the same mcpServers format
    serde_json::to_string_pretty(&parsed)
        .map_err(|e| format!("Failed to serialize Gemini settings: {}", e))
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SpawnAgentArgs {
    pub prompt: String,
    pub agent: Option<String>,
    pub persona_model: Option<String>,
    pub working_directory: Option<String>,
    pub session_id: Option<String>,
    pub stage_execution_id: Option<String>,
    pub append_system_prompt: Option<String>,
    pub json_schema: Option<String>,
    pub output_format: Option<String>,
    pub no_session_persistence: Option<bool>,
    pub allowed_tools: Option<Vec<String>>,
    pub max_turns: Option<u32>,
    pub mcp_config: Option<String>,
}

#[tauri::command]
pub async fn spawn_agent(
    args: SpawnAgentArgs,
    on_event: Channel<AgentStreamEvent>,
    process_manager: State<'_, ProcessManager>,
) -> Result<String, String> {
    let process_id = uuid::Uuid::new_v4().to_string();

    let agent = args
        .agent
        .as_deref()
        .and_then(Agent::from_str_opt)
        .unwrap_or(Agent::Claude);

    // Create temp context for this process
    let mut temp_ctx = TempContext::new(&process_id)?;

    let mut cmd = if agent == Agent::Codex {
        let mut c = Command::new(agent.binary());
        c.arg("exec");
        c
    } else {
        Command::new(agent.binary())
    };

    // Auto-approve flag
    if let Some(flag) = agent.auto_approve_flag() {
        cmd.arg(flag);
    }

    // Prompt
    cmd.arg("-p").arg(&args.prompt);

    // Output format
    match agent {
        Agent::Claude => {
            let output_format = args.output_format.as_deref().unwrap_or("stream-json");
            cmd.arg("--output-format").arg(output_format);
            if output_format == "stream-json" && agent.supports_verbose() {
                cmd.arg("--verbose");
            }
        }
        Agent::Codex => {
            cmd.arg("--json");
        }
        Agent::Gemini | Agent::OpenCode => {
            cmd.arg("--output-format").arg("stream-json");
        }
        Agent::Amp => {
            cmd.arg("--stream-json");
        }
    }

    // Model override (persona_model)
    if let Some(ref model) = args.persona_model {
        match agent {
            Agent::Codex | Agent::Gemini | Agent::Amp => {
                cmd.arg("--model").arg(model);
            }
            _ => {} // Claude uses persona_model differently; OpenCode doesn't support --model
        }
    }

    // Session ID (Claude only)
    if agent.supports_session_id() {
        if let Some(ref session_id) = args.session_id {
            cmd.arg("--session-id").arg(session_id);
        }
    }

    // System prompt — per-agent mechanism
    if let Some(ref system_prompt) = args.append_system_prompt {
        match agent {
            Agent::Claude | Agent::Amp => {
                cmd.arg("--append-system-prompt").arg(system_prompt);
            }
            Agent::Codex => {
                // Write AGENTS.md in the working directory for Codex to pick up
                if let Some(ref dir) = args.working_directory {
                    temp_ctx.write_workdir_file(
                        Path::new(dir),
                        "AGENTS.md",
                        system_prompt,
                    )?;
                }
            }
            Agent::Gemini => {
                // Write system prompt to temp file and set GEMINI_SYSTEM_MD env var
                let path = temp_ctx.write_temp_file("system_prompt.md", system_prompt)?;
                cmd.env("GEMINI_SYSTEM_MD", &path);
            }
            Agent::OpenCode => {
                // No system prompt support
            }
        }
    }

    // JSON schema — per-agent mechanism
    if let Some(ref schema) = args.json_schema {
        match agent {
            Agent::Claude => {
                cmd.arg("--json-schema").arg(schema);
            }
            Agent::Codex => {
                // Codex uses --output-schema <file_path>
                let path = temp_ctx.write_temp_file("output_schema.json", schema)?;
                cmd.arg("--output-schema").arg(&path);
            }
            _ => {
                // Other agents don't support JSON schema via CLI flag
            }
        }
    }

    // No session persistence (Claude only)
    if agent.supports_no_session_persistence() && args.no_session_persistence.unwrap_or(false) {
        cmd.arg("--no-session-persistence");
    }

    // Allowed tools (Claude only)
    if agent.supports_allowed_tools() {
        if let Some(ref tools) = args.allowed_tools {
            if tools.is_empty() {
                // An empty list means "no tools at all" — pass a non-existent tool
                // name so the CLI restricts to zero real tools.
                cmd.arg("--allowedTools").arg("_none_");
            } else {
                for tool in tools {
                    cmd.arg("--allowedTools").arg(tool);
                }
            }
        }
    }

    // Max turns (Claude only)
    if agent.supports_max_turns() {
        if let Some(max_turns) = args.max_turns {
            cmd.arg("--max-turns").arg(max_turns.to_string());
        }
    }

    // MCP config — per-agent mechanism
    if let Some(ref mcp_config) = args.mcp_config {
        match agent {
            Agent::Claude => {
                cmd.arg("--mcp-config").arg(mcp_config);
            }
            Agent::Codex => {
                // Write .codex/config.toml in the working directory
                if let Some(ref dir) = args.working_directory {
                    let toml = convert_mcp_json_to_codex_toml(mcp_config)?;
                    temp_ctx.write_workdir_file(
                        Path::new(dir),
                        ".codex/config.toml",
                        &toml,
                    )?;
                }
            }
            Agent::Gemini => {
                // Write .gemini/settings.json in the working directory
                if let Some(ref dir) = args.working_directory {
                    let settings = convert_mcp_json_to_gemini_settings(mcp_config)?;
                    temp_ctx.write_workdir_file(
                        Path::new(dir),
                        ".gemini/settings.json",
                        &settings,
                    )?;
                }
            }
            _ => {
                // Amp, OpenCode: no MCP config support
            }
        }
    }

    if let Some(ref dir) = args.working_directory {
        cmd.current_dir(dir);
    }

    cmd.stdout(std::process::Stdio::piped());
    cmd.stderr(std::process::Stdio::piped());

    let mut child = cmd.spawn().map_err(|e| format!("Failed to spawn {}: {}", agent.binary(), e))?;

    let (kill_tx, kill_rx) = tokio::sync::oneshot::channel::<()>();

    process_manager
        .register(
            process_id.clone(),
            kill_tx,
            args.stage_execution_id.clone(),
            args.session_id.clone(),
        )
        .await;

    let _ = on_event.send(AgentStreamEvent::Started {
        process_id: process_id.clone(),
        session_id: args.session_id.clone(),
    });

    let stdout = child.stdout.take().ok_or("stdout not piped")?;
    let stderr = child.stderr.take().ok_or("stderr not piped")?;

    let stdout_event = on_event.clone();
    let stdout_task = tokio::spawn(async move {
        let reader = BufReader::new(stdout);
        let mut lines = reader.lines();
        while let Ok(Some(line)) = lines.next_line().await {
            let _ = stdout_event.send(AgentStreamEvent::StdoutLine { line });
        }
    });

    let stderr_event = on_event.clone();
    let stderr_task = tokio::spawn(async move {
        let reader = BufReader::new(stderr);
        let mut lines = reader.lines();
        while let Ok(Some(line)) = lines.next_line().await {
            let _ = stderr_event.send(AgentStreamEvent::StderrLine { line });
        }
    });

    let pid = process_id.clone();
    let completion_event = on_event.clone();
    let pm = process_manager.inner().clone();

    tokio::spawn(async move {
        let exit_code = tokio::select! {
            status = child.wait() => {
                match status {
                    Ok(s) => s.code(),
                    Err(_) => None,
                }
            }
            _ = kill_rx => {
                let _ = child.kill().await;
                None
            }
        };

        let _ = stdout_task.await;
        let _ = stderr_task.await;

        // Clean up temp files after process exits
        temp_ctx.cleanup();

        let _ = completion_event.send(AgentStreamEvent::Completed {
            process_id: pid.clone(),
            exit_code,
        });

        pm.remove(&pid).await;
    });

    Ok(process_id)
}

#[tauri::command]
pub async fn kill_process(
    process_id: String,
    process_manager: State<'_, ProcessManager>,
) -> Result<(), String> {
    process_manager.kill(&process_id).await
}

#[tauri::command]
pub async fn list_processes(
    process_manager: State<'_, ProcessManager>,
) -> Result<Vec<String>, String> {
    Ok(process_manager.list_running().await)
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProcessInfo {
    pub process_id: String,
    pub stage_execution_id: Option<String>,
}

#[tauri::command]
pub async fn list_processes_detailed(
    process_manager: State<'_, ProcessManager>,
) -> Result<Vec<ProcessInfo>, String> {
    Ok(process_manager
        .list_running_detailed()
        .await
        .into_iter()
        .map(|(process_id, stage_execution_id)| ProcessInfo {
            process_id,
            stage_execution_id,
        })
        .collect())
}

#[tauri::command]
pub async fn check_agent_available(agent: Option<String>) -> Result<String, String> {
    let resolved = agent
        .as_deref()
        .and_then(Agent::from_str_opt)
        .unwrap_or(Agent::Claude);

    let output = Command::new(resolved.binary())
        .arg("--version")
        .output()
        .await
        .map_err(|e| format!("{} CLI not found: {}", resolved.binary(), e))?;

    if output.status.success() {
        let version = String::from_utf8_lossy(&output.stdout).trim().to_string();
        Ok(version)
    } else {
        Err(format!("{} CLI returned error", resolved.binary()))
    }
}
