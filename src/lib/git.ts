import { invoke } from "@tauri-apps/api/core";

export async function runGit(workingDir: string, ...args: string[]): Promise<string> {
  return invoke<string>("run_git_command", {
    args,
    workingDirectory: workingDir,
  });
}

export async function gitStatus(workingDir: string): Promise<string> {
  return runGit(workingDir, "status", "--porcelain");
}

export async function gitDiff(workingDir: string): Promise<string> {
  return runGit(workingDir, "diff");
}

export async function gitDiffStat(workingDir: string): Promise<string> {
  return runGit(workingDir, "diff", "--stat");
}

export async function gitAdd(workingDir: string): Promise<string> {
  return runGit(workingDir, "add", "-A");
}

export async function gitCommit(workingDir: string, message: string): Promise<string> {
  return runGit(workingDir, "commit", "-m", message);
}

export async function gitCreateBranch(workingDir: string, name: string): Promise<string> {
  return runGit(workingDir, "checkout", "-b", name);
}

export async function gitCheckoutBranch(workingDir: string, name: string): Promise<string> {
  return runGit(workingDir, "checkout", name);
}

export async function gitCurrentBranch(workingDir: string): Promise<string> {
  return runGit(workingDir, "branch", "--show-current");
}

export async function gitBranchExists(workingDir: string, name: string): Promise<boolean> {
  try {
    const result = await runGit(workingDir, "branch", "--list", name);
    return result.trim().length > 0;
  } catch {
    return false;
  }
}

export async function hasUncommittedChanges(workingDir: string): Promise<boolean> {
  try {
    const status = await gitStatus(workingDir);
    return status.trim().length > 0;
  } catch {
    return false;
  }
}

export async function isGitRepo(workingDir: string): Promise<boolean> {
  try {
    await runGit(workingDir, "rev-parse", "--git-dir");
    return true;
  } catch {
    return false;
  }
}

export async function readFileContents(path: string): Promise<string | null> {
  return invoke<string | null>("read_file_contents", { path });
}
