mod agents;
mod process_manager;
mod pty_manager;
mod events;
mod commands;

use process_manager::ProcessManager;
use pty_manager::PtyManager;
use tauri::Manager;
use tauri::menu::{MenuBuilder, SubmenuBuilder};

#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! Backend connection verified.", name)
}

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

/// On macOS/Linux, GUI apps don't inherit the user's shell PATH.
/// This resolves the full PATH from the user's default shell so that
/// CLI tools like `claude`, `node`, `git`, etc. can be found.
fn fix_path_env() {
    #[cfg(not(target_os = "windows"))]
    {
        use std::process::Command;
        let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/zsh".to_string());
        if let Ok(output) = Command::new(&shell)
            .args(["-ilc", "echo $PATH"])
            .output()
        {
            if output.status.success() {
                let path = String::from_utf8_lossy(&output.stdout).trim().to_string();
                if !path.is_empty() {
                    std::env::set_var("PATH", &path);
                }
            }
        }
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    fix_path_env();

    tauri::Builder::default()
        .plugin(tauri_plugin_sql::Builder::default().build())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_notification::init())
        .manage(ProcessManager::new())
        .manage(PtyManager::new())
        .setup(|app| {
            // Build a custom menu without the Close Window (Cmd+W) shortcut
            // so that Cmd+W can be handled by the frontend to close editor tabs.
            let app_menu = SubmenuBuilder::new(app, "stagehand")
                .about(None)
                .separator()
                .services()
                .separator()
                .hide()
                .hide_others()
                .show_all()
                .separator()
                .quit()
                .build()?;
            let edit_menu = SubmenuBuilder::new(app, "Edit")
                .undo()
                .redo()
                .separator()
                .cut()
                .copy()
                .paste()
                .select_all()
                .build()?;
            let view_menu = SubmenuBuilder::new(app, "View")
                .fullscreen()
                .build()?;
            let window_menu = SubmenuBuilder::new(app, "Window")
                .minimize()
                .build()?;
            let menu = MenuBuilder::new(app)
                .items(&[&app_menu, &edit_menu, &view_menu, &window_menu])
                .build()?;
            app.set_menu(menu)?;

            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }

            // Create ~/.stagehand/data/ directory
            if let Some(home) = dirs::home_dir() {
                let stagehand_dir = home.join(".stagehand").join("data");
                std::fs::create_dir_all(&stagehand_dir).ok();
                log::info!("Stagehand data dir: {:?}", stagehand_dir);

                // Clean up stale temp dirs from crashed processes
                let tmp_dir = home.join(".stagehand").join("tmp");
                if tmp_dir.exists() {
                    std::fs::remove_dir_all(&tmp_dir).ok();
                    log::info!("Cleaned up stale temp dir: {:?}", tmp_dir);
                }
            }

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            greet,
            get_stagehand_dir,
            get_mcp_server_path,
            commands::process::spawn_agent,
            commands::process::kill_process,
            commands::process::list_processes,
            commands::process::list_processes_detailed,
            commands::process::check_agent_available,
            commands::git::run_git_command,
            commands::git::run_gh_command,
            commands::git::read_file_contents,
            commands::git::read_file_base64,
            commands::git::write_file_contents,
            commands::pty::spawn_pty,
            commands::pty::write_to_pty,
            commands::pty::resize_pty,
            commands::pty::kill_pty,
            commands::editor::open_in_external_editor,
        ])
        .on_window_event(|_window, event| {
            if let tauri::WindowEvent::Destroyed = event {
                // Process cleanup happens via Drop
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
