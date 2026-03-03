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

#[tauri::command]
pub async fn read_file_base64(path: String) -> Result<Option<String>, String> {
    use base64::Engine;
    match tokio::fs::read(&path).await {
        Ok(bytes) => Ok(Some(base64::engine::general_purpose::STANDARD.encode(&bytes))),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(format!("Failed to read file: {}", e)),
    }
}

#[tauri::command]
pub async fn write_file_contents(path: String, contents: String, worktree_root: String) -> Result<(), String> {
    // Validate that the target path is within the worktree
    let canonical_root = std::path::Path::new(&worktree_root)
        .canonicalize()
        .map_err(|e| format!("Invalid worktree root: {}", e))?;
    let canonical_path = std::path::Path::new(&path)
        .canonicalize()
        .or_else(|_| {
            // File may not exist yet; canonicalize parent instead
            let p = std::path::Path::new(&path);
            if let Some(parent) = p.parent() {
                parent.canonicalize().map(|pp| pp.join(p.file_name().unwrap_or_default()))
            } else {
                Err(std::io::Error::new(std::io::ErrorKind::NotFound, "No parent directory"))
            }
        })
        .map_err(|e| format!("Invalid file path: {}", e))?;

    if !canonical_path.starts_with(&canonical_root) {
        return Err("Path is outside the worktree — write denied".to_string());
    }

    tokio::fs::write(&path, contents.as_bytes())
        .await
        .map_err(|e| format!("Failed to write file: {}", e))
}

