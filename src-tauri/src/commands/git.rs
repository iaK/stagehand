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
        let combined = [stderr.as_str(), stdout.as_str()]
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

/// Max file size for reading: 10 MB
const MAX_READ_SIZE: u64 = 10 * 1024 * 1024;

/// Canonicalize a path, handling files that don't exist yet by canonicalizing the parent.
fn resolve_canonical(path: &std::path::Path) -> Result<std::path::PathBuf, String> {
    path.canonicalize()
        .or_else(|_| {
            if let Some(parent) = path.parent() {
                parent.canonicalize().map(|pp| pp.join(path.file_name().unwrap_or_default()))
            } else {
                Err(std::io::Error::new(std::io::ErrorKind::NotFound, "No parent directory"))
            }
        })
        .map_err(|e| format!("Invalid file path: {}", e))
}

/// Validate that a canonical path is within the given root directory.
fn validate_path_in_root(canonical_path: &std::path::Path, root: &str) -> Result<std::path::PathBuf, String> {
    let canonical_root = std::path::Path::new(root)
        .canonicalize()
        .map_err(|e| format!("Invalid root path: {}", e))?;

    if !canonical_path.starts_with(&canonical_root) {
        return Err("Path is outside the allowed directory — access denied".to_string());
    }

    Ok(canonical_root)
}

/// Validate that a canonical path is within the given worktree root,
/// and that the worktree root is under a `.stagehand-worktrees` directory.
fn validate_path_in_worktree(canonical_path: &std::path::Path, worktree_root: &str) -> Result<std::path::PathBuf, String> {
    let canonical_root = validate_path_in_root(canonical_path, worktree_root)?;

    // Validate that the worktree root is under a .stagehand-worktrees directory
    let root_str = canonical_root.to_string_lossy();
    if !root_str.contains("/.stagehand-worktrees/") && !root_str.contains("\\.stagehand-worktrees\\") {
        return Err("Worktree root must be under a .stagehand-worktrees directory".to_string());
    }

    Ok(canonical_root)
}

#[tauri::command]
pub async fn read_file_contents(path: String, worktree_root: String) -> Result<Option<String>, String> {
    let canonical_path = resolve_canonical(std::path::Path::new(&path))?;
    validate_path_in_root(&canonical_path, &worktree_root)?;

    // Check file size before reading
    match tokio::fs::metadata(&canonical_path).await {
        Ok(meta) => {
            if meta.len() > MAX_READ_SIZE {
                return Err(format!("File too large ({:.1} MB). Maximum is {} MB.",
                    meta.len() as f64 / (1024.0 * 1024.0),
                    MAX_READ_SIZE / (1024 * 1024)));
            }
        }
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(e) => return Err(format!("Failed to read file metadata: {}", e)),
    }

    match tokio::fs::read_to_string(&canonical_path).await {
        Ok(contents) => Ok(Some(contents)),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(format!("Failed to read file: {}", e)),
    }
}

#[tauri::command]
pub async fn read_file_base64(path: String, worktree_root: String) -> Result<Option<String>, String> {
    use base64::Engine;

    let canonical_path = resolve_canonical(std::path::Path::new(&path))?;
    validate_path_in_root(&canonical_path, &worktree_root)?;

    // Check file size before reading
    match tokio::fs::metadata(&canonical_path).await {
        Ok(meta) => {
            if meta.len() > MAX_READ_SIZE {
                return Err(format!("File too large ({:.1} MB). Maximum is {} MB.",
                    meta.len() as f64 / (1024.0 * 1024.0),
                    MAX_READ_SIZE / (1024 * 1024)));
            }
        }
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(e) => return Err(format!("Failed to read file metadata: {}", e)),
    }

    match tokio::fs::read(&canonical_path).await {
        Ok(bytes) => Ok(Some(base64::engine::general_purpose::STANDARD.encode(&bytes))),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(format!("Failed to read file: {}", e)),
    }
}

#[tauri::command]
pub async fn write_file_contents(path: String, contents: String, worktree_root: String) -> Result<(), String> {
    let canonical_path = resolve_canonical(std::path::Path::new(&path))?;
    validate_path_in_worktree(&canonical_path, &worktree_root)?;

    // Write to canonical_path, not the original path (fixes TOCTOU via symlinks)
    tokio::fs::write(&canonical_path, contents.as_bytes())
        .await
        .map_err(|e| format!("Failed to write file: {}", e))
}
