mod agents;
mod process_manager;
mod pty_manager;
mod events;
mod commands;

use process_manager::ProcessManager;
use pty_manager::PtyManager;
use tauri::Manager;

#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! Backend connection verified.", name)
}

#[tauri::command]
fn get_devflow_dir() -> Result<String, String> {
    let home = dirs::home_dir().ok_or("Could not find home directory")?;
    let devflow_dir = home.join(".devflow");
    Ok(devflow_dir.to_string_lossy().to_string())
}

#[tauri::command]
fn get_mcp_server_path(app_handle: tauri::AppHandle) -> Result<String, String> {
    // In development, resolve from CARGO_MANIFEST_DIR
    if cfg!(debug_assertions) {
        let manifest_dir = env!("CARGO_MANIFEST_DIR");
        let path = std::path::Path::new(manifest_dir)
            .join("mcp-server")
            .join("stagehand-context.mjs");
        if path.exists() {
            return Ok(path.to_string_lossy().to_string());
        }
    }

    // In production, resolve from Tauri resource dir
    let resource_path = app_handle
        .path()
        .resource_dir()
        .map_err(|e| format!("Could not get resource dir: {}", e))?
        .join("mcp-server")
        .join("stagehand-context.mjs");

    if resource_path.exists() {
        Ok(resource_path.to_string_lossy().to_string())
    } else {
        Err(format!(
            "MCP server not found at: {}",
            resource_path.to_string_lossy()
        ))
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_sql::Builder::default().build())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_notification::init())
        .manage(ProcessManager::new())
        .manage(PtyManager::new())
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }

            // Create ~/.devflow/data/ directory
            if let Some(home) = dirs::home_dir() {
                let devflow_dir = home.join(".devflow").join("data");
                std::fs::create_dir_all(&devflow_dir).ok();
                log::info!("DevFlow data dir: {:?}", devflow_dir);

                // Clean up stale temp dirs from crashed processes
                let tmp_dir = home.join(".devflow").join("tmp");
                if tmp_dir.exists() {
                    std::fs::remove_dir_all(&tmp_dir).ok();
                    log::info!("Cleaned up stale temp dir: {:?}", tmp_dir);
                }
            }

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            greet,
            get_devflow_dir,
            get_mcp_server_path,
            commands::process::spawn_agent,
            commands::process::kill_process,
            commands::process::list_processes,
            commands::process::list_processes_detailed,
            commands::process::check_agent_available,
            commands::git::run_git_command,
            commands::git::run_gh_command,
            commands::git::read_file_contents,
            commands::pty::spawn_pty,
            commands::pty::write_to_pty,
            commands::pty::resize_pty,
            commands::pty::kill_pty,
        ])
        .on_window_event(|_window, event| {
            if let tauri::WindowEvent::Destroyed = event {
                // Process cleanup happens via Drop
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
