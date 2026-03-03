use serde::Serialize;
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
pub async fn write_file_contents(path: String, contents: String) -> Result<(), String> {
    tokio::fs::write(&path, contents.as_bytes())
        .await
        .map_err(|e| format!("Failed to write file: {}", e))
}

#[derive(Serialize)]
pub struct DirEntry {
    pub name: String,
    pub is_dir: bool,
    pub path: String,
}

#[tauri::command]
pub async fn list_directory(path: String) -> Result<Vec<DirEntry>, String> {
    let mut entries = Vec::new();
    let mut reader = tokio::fs::read_dir(&path)
        .await
        .map_err(|e| format!("Failed to read directory: {}", e))?;

    while let Some(entry) = reader
        .next_entry()
        .await
        .map_err(|e| format!("Failed to read entry: {}", e))?
    {
        let metadata = entry
            .metadata()
            .await
            .map_err(|e| format!("Failed to read metadata: {}", e))?;
        let name = entry.file_name().to_string_lossy().to_string();
        // Skip hidden files/directories
        if name.starts_with('.') {
            continue;
        }
        entries.push(DirEntry {
            name,
            is_dir: metadata.is_dir(),
            path: entry.path().to_string_lossy().to_string(),
        });
    }

    entries.sort_by(|a, b| {
        // Directories first, then alphabetical
        b.is_dir.cmp(&a.is_dir).then(a.name.cmp(&b.name))
    });

    Ok(entries)
}
