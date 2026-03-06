use std::process::Command;

#[tauri::command]
pub fn open_in_external_editor(command: String, path: String) -> Result<(), String> {
    Command::new(&command)
        .arg(&path)
        .spawn()
        .map_err(|e| format!("Failed to open editor '{}': {}", command, e))?;
    Ok(())
}
