use crate::agent::get_agent_config;
use crate::events::AgentStreamEvent;
use crate::process_manager::ProcessManager;
use serde::Deserialize;
use tauri::ipc::Channel;
use tauri::State;
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::Command;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SpawnAgentArgs {
    pub prompt: String,
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
    #[serde(default)]
    pub agent_name: Option<String>,
}

#[tauri::command]
pub async fn spawn_agent(
    args: SpawnAgentArgs,
    on_event: Channel<AgentStreamEvent>,
    process_manager: State<'_, ProcessManager>,
) -> Result<String, String> {
    let process_id = uuid::Uuid::new_v4().to_string();

    let config = get_agent_config(args.agent_name.as_deref().unwrap_or("claude"));

    let mut cmd = Command::new(config.command);
    cmd.arg(config.skip_permissions_flag);
    cmd.arg(config.prompt_flag).arg(&args.prompt);

    let output_format = args.output_format.as_deref().unwrap_or("stream-json");
    cmd.arg(config.output_format_flag).arg(output_format);

    if output_format == "stream-json" {
        cmd.arg("--verbose");
    }

    if let Some(ref session_id) = args.session_id {
        cmd.arg("--session-id").arg(session_id);
    }

    if let Some(ref system_prompt) = args.append_system_prompt {
        cmd.arg(config.system_prompt_flag).arg(system_prompt);
    }

    if let Some(ref schema) = args.json_schema {
        cmd.arg("--json-schema").arg(schema);
    }

    if args.no_session_persistence.unwrap_or(false) {
        cmd.arg("--no-session-persistence");
    }

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

    if let Some(max_turns) = args.max_turns {
        cmd.arg("--max-turns").arg(max_turns.to_string());
    }

    if let Some(ref mcp_config) = args.mcp_config {
        cmd.arg("--mcp-config").arg(mcp_config);
    }

    if let Some(ref dir) = args.working_directory {
        cmd.current_dir(dir);
    }

    cmd.stdout(std::process::Stdio::piped());
    cmd.stderr(std::process::Stdio::piped());

    let mut child = cmd.spawn().map_err(|e| format!("Failed to spawn agent: {}", e))?;

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
pub async fn check_agent_available() -> Result<String, String> {
    let config = get_agent_config("claude");
    let output = Command::new(config.command)
        .arg(config.version_flag)
        .output()
        .await
        .map_err(|e| format!("Agent CLI not found: {}", e))?;

    if output.status.success() {
        let version = String::from_utf8_lossy(&output.stdout).trim().to_string();
        Ok(version)
    } else {
        Err("Agent CLI returned error".to_string())
    }
}
