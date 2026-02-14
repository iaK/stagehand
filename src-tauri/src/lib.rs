mod process_manager;
mod events;
mod commands;

use process_manager::ProcessManager;

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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_sql::Builder::default().build())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_shell::init())
        .manage(ProcessManager::new())
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
            }

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            greet,
            get_devflow_dir,
            commands::process::spawn_claude,
            commands::process::kill_process,
            commands::process::list_processes,
            commands::process::check_claude_available,
        ])
        .on_window_event(|_window, event| {
            if let tauri::WindowEvent::Destroyed = event {
                // Process cleanup happens via Drop
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
