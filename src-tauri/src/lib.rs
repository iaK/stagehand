mod process_manager;
mod events;
mod commands;

use process_manager::ProcessManager;
use tauri::Manager;

#[tauri::command]
fn get_stagehand_dir() -> Result<String, String> {
    let home = dirs::home_dir().ok_or("Could not find home directory")?;
    let stagehand_dir = home.join(".stagehand");
    Ok(stagehand_dir.to_string_lossy().to_string())
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

#[tauri::command]
fn delete_project_db(project_id: String) -> Result<(), String> {
    let home = dirs::home_dir().ok_or("Could not find home directory")?;
    let db_path = home.join(".stagehand").join("data").join(format!("{}.db", project_id));
    if db_path.exists() {
        std::fs::remove_file(&db_path)
            .map_err(|e| format!("Failed to delete project DB: {}", e))?;
    }
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_sql::Builder::default().build())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_notification::init())
        .manage(ProcessManager::new())
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }

            // Migrate ~/.devflow → ~/.stagehand if needed
            if let Some(home) = dirs::home_dir() {
                let old_dir = home.join(".devflow");
                let new_dir = home.join(".stagehand");
                if old_dir.exists() && !new_dir.exists() {
                    if let Err(e) = std::fs::rename(&old_dir, &new_dir) {
                        log::warn!("Failed to migrate .devflow to .stagehand: {}", e);
                    }
                }
            }

            // Create ~/.stagehand/data/ directory
            if let Some(home) = dirs::home_dir() {
                let data_dir = home.join(".stagehand").join("data");
                std::fs::create_dir_all(&data_dir).ok();
                log::info!("Stagehand data dir: {:?}", data_dir);
            }

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_stagehand_dir,
            get_mcp_server_path,
            delete_project_db,
            commands::process::spawn_claude,
            commands::process::kill_process,
            commands::process::list_processes,
            commands::process::list_processes_detailed,
            commands::process::check_claude_available,
            commands::git::run_git_command,
            commands::git::run_gh_command,
            commands::git::read_file_contents,
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app_handle, event| {
            if let tauri::RunEvent::Exit = event {
                let pm = app_handle.state::<ProcessManager>();
                tauri::async_runtime::block_on(pm.kill_all());
            }
        });
}
