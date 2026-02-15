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

export async function gitRemoteUrl(workingDir: string): Promise<string | null> {
  try {
    const url = await runGit(workingDir, "remote", "get-url", "origin");
    return url.trim() || null;
  } catch {
    return null;
  }
}

export function parseGitRemote(url: string): { owner: string; repo: string } | null {
  // SSH: git@github.com:owner/repo.git
  const sshMatch = url.match(/git@[^:]+:([^/]+)\/([^/.]+?)(?:\.git)?$/);
  if (sshMatch) return { owner: sshMatch[1], repo: sshMatch[2] };

  // HTTPS: https://github.com/owner/repo.git
  const httpsMatch = url.match(/https?:\/\/[^/]+\/([^/]+)\/([^/.]+?)(?:\.git)?$/);
  if (httpsMatch) return { owner: httpsMatch[1], repo: httpsMatch[2] };

  return null;
}

export async function gitDefaultBranch(workingDir: string): Promise<string | null> {
  try {
    const ref = await runGit(workingDir, "symbolic-ref", "refs/remotes/origin/HEAD");
    // Returns e.g. "refs/remotes/origin/main"
    const branch = ref.trim().replace("refs/remotes/origin/", "");
    return branch || null;
  } catch {
    return null;
  }
}

export async function readFileContents(path: string): Promise<string | null> {
  return invoke<string | null>("read_file_contents", { path });
}
