use crate::agents::Agent;
use crate::events::PtyEvent;
use crate::pty_manager::{PtyEntry, PtyManager};
use portable_pty::{CommandBuilder, PtySize, native_pty_system};
use serde::Deserialize;
use tauri::ipc::Channel;
use tauri::State;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SpawnPtyArgs {
    pub agent: Option<String>,
    pub working_directory: Option<String>,
    pub append_system_prompt: Option<String>,
    pub cols: Option<u16>,
    pub rows: Option<u16>,
}

#[tauri::command]
pub async fn spawn_pty(
    args: SpawnPtyArgs,
    on_event: Channel<PtyEvent>,
    pty_manager: State<'_, PtyManager>,
) -> Result<String, String> {
    let session_id = uuid::Uuid::new_v4().to_string();

    let agent = args
        .agent
        .as_deref()
        .and_then(Agent::from_str_opt)
        .unwrap_or(Agent::Claude);

    let cols = args.cols.unwrap_or(120);
    let rows = args.rows.unwrap_or(24);

    let pty_system = native_pty_system();
    let pair = pty_system
        .openpty(PtySize {
            rows,
            cols,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|e| format!("Failed to open PTY: {}", e))?;

    let mut cmd = CommandBuilder::new(agent.binary());

    if let Some(flag) = agent.auto_approve_flag() {
        cmd.arg(flag);
    }

    if agent.supports_append_system_prompt() {
        if let Some(ref system_prompt) = args.append_system_prompt {
            cmd.arg("--append-system-prompt");
            cmd.arg(system_prompt);
        }
    }

    if let Some(ref dir) = args.working_directory {
        cmd.cwd(dir);
    }

    let child = pair
        .slave
        .spawn_command(cmd)
        .map_err(|e| format!("Failed to spawn {} in PTY: {}", agent.binary(), e))?;

    // Drop the slave side — the child owns it now
    drop(pair.slave);

    let writer = pair
        .master
        .take_writer()
        .map_err(|e| format!("Failed to get PTY writer: {}", e))?;

    let reader = pair
        .master
        .try_clone_reader()
        .map_err(|e| format!("Failed to get PTY reader: {}", e))?;

    let (kill_tx, kill_rx) = tokio::sync::oneshot::channel::<()>();

    let entry = PtyEntry {
        writer,
        child,
        master_pty: pair.master,
        kill_tx: Some(kill_tx),
    };

    pty_manager.register(session_id.clone(), entry).await;

    let _ = on_event.send(PtyEvent::Started {
        id: session_id.clone(),
    });

    // Spawn a blocking read loop for PTY output
    let sid = session_id.clone();
    let output_event = on_event.clone();
    tokio::task::spawn_blocking(move || {
        use std::io::Read;
        let mut reader = reader;
        let mut buf = [0u8; 4096];
        loop {
            match reader.read(&mut buf) {
                Ok(0) => break,
                Ok(n) => {
                    let data = String::from_utf8_lossy(&buf[..n]).to_string();
                    let _ = output_event.send(PtyEvent::Output { data });
                }
                Err(_) => break,
            }
        }
        let _ = sid; // keep sid alive for the duration
    });

    // Spawn a task that waits for child exit or kill signal
    let sid = session_id.clone();
    let pm = pty_manager.inner().clone();
    let exit_event = on_event.clone();
    tokio::spawn(async move {
        let exit_code: Option<i32> = tokio::select! {
            // Poll child exit in a blocking thread
            result = tokio::task::spawn_blocking({
                let pm = pm.clone();
                let sid = sid.clone();
                move || -> Option<i32> {
                    loop {
                        std::thread::sleep(std::time::Duration::from_millis(100));
                        let rt = tokio::runtime::Handle::current();
                        let mut sessions = rt.block_on(pm.sessions.lock());
                        if let Some(entry) = sessions.get_mut(&sid) {
                            if let Ok(Some(status)) = entry.child.try_wait() {
                                return Some(status.exit_code() as i32);
                            }
                        } else {
                            return None;
                        }
                        drop(sessions);
                    }
                }
            }) => {
                result.unwrap_or(None)
            }
            _ = kill_rx => {
                // Kill requested — try to kill the child
                let mut sessions = pm.sessions.lock().await;
                if let Some(entry) = sessions.get_mut(&sid) {
                    let _ = entry.child.kill();
                }
                drop(sessions);
                None
            }
        };

        let _ = exit_event.send(PtyEvent::Exited {
            id: sid.clone(),
            exit_code,
        });

        pm.remove(&sid).await;
    });

    Ok(session_id)
}

#[tauri::command]
pub async fn write_to_pty(
    id: String,
    data: String,
    pty_manager: State<'_, PtyManager>,
) -> Result<(), String> {
    pty_manager.write(&id, data.as_bytes()).await
}

#[tauri::command]
pub async fn resize_pty(
    id: String,
    cols: u16,
    rows: u16,
    pty_manager: State<'_, PtyManager>,
) -> Result<(), String> {
    pty_manager.resize(&id, cols, rows).await
}

#[tauri::command]
pub async fn kill_pty(
    id: String,
    pty_manager: State<'_, PtyManager>,
) -> Result<(), String> {
    pty_manager.kill(&id).await
}
