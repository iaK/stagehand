use tokio::process::Command;

#[tauri::command]
pub async fn run_git_command(args: Vec<String>, working_directory: String) -> Result<String, String> {
    let output = Command::new("git")
        .args(&args)
        .current_dir(&working_directory)
        .output()
        .await
        .map_err(|e| format!("Failed to run git: {}", e))?;

    if output.status.success() {
        Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
    } else {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        Err(if stderr.is_empty() {
            format!("git exited with code {}", output.status.code().unwrap_or(-1))
        } else {
            stderr
        })
    }
}

#[tauri::command]
pub async fn read_file_contents(path: String) -> Result<Option<String>, String> {
    match tokio::fs::read_to_string(&path).await {
        Ok(contents) => Ok(Some(contents)),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(format!("Failed to read file: {}", e)),
    }
}
