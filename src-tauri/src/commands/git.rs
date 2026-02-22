use tokio::process::Command;

async fn run_command(binary: &str, args: Vec<String>, working_directory: String) -> Result<String, String> {
    let output = Command::new(binary)
        .args(&args)
        .current_dir(&working_directory)
        .output()
        .await
        .map_err(|e| format!("Failed to run {}: {}", binary, e))?;

    if output.status.success() {
        Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
    } else {
        let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        let combined = [&stderr, &stdout]
            .iter()
            .filter(|s| !s.is_empty())
            .cloned()
            .cloned()
            .collect::<Vec<_>>()
            .join("\n");
        Err(if combined.is_empty() {
            format!("{} exited with code {}", binary, output.status.code().unwrap_or(-1))
        } else {
            combined
        })
    }
}

#[tauri::command]
pub async fn run_git_command(args: Vec<String>, working_directory: String) -> Result<String, String> {
    run_command("git", args, working_directory).await
}

#[tauri::command]
pub async fn run_gh_command(args: Vec<String>, working_directory: String) -> Result<String, String> {
    run_command("gh", args, working_directory).await
}

#[tauri::command]
pub async fn read_file_contents(path: String) -> Result<Option<String>, String> {
    match tokio::fs::read_to_string(&path).await {
        Ok(contents) => Ok(Some(contents)),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(format!("Failed to read file: {}", e)),
    }
}
