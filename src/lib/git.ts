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

export async function gitAddFiles(workingDir: string, files: string[]): Promise<string> {
  if (files.length === 0) return "";
  return runGit(workingDir, "add", "--", ...files);
}

export async function getChangedFiles(workingDir: string): Promise<string[]> {
  const status = await gitStatus(workingDir);
  return status
    .trim()
    .split("\n")
    .filter((line) => line.length > 0)
    .map((line) => line.slice(3).trim());
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

export interface GitCommit {
  hash: string;
  message: string;
  date: string;
  author: string;
}

export async function gitLog(workingDir: string, maxCount: number = 50): Promise<GitCommit[]> {
  try {
    const delimiter = "---END-COMMIT---";
    const raw = await runGit(
      workingDir,
      "log",
      `--max-count=${maxCount}`,
      `--format=%H%n%s%n%aI%n%an%n${delimiter}`,
    );
    return raw
      .trim()
      .split(`${delimiter}\n`)
      .filter((block) => block.trim())
      .map((block) => {
        const [hash, message, date, author] = block.trim().split("\n");
        return { hash, message, date, author };
      });
  } catch {
    return [];
  }
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

export async function gitWorktreeAdd(
  workingDir: string,
  worktreePath: string,
  branchName: string,
  createBranch: boolean,
): Promise<string> {
  if (createBranch) {
    return runGit(workingDir, "worktree", "add", worktreePath, "-b", branchName);
  }
  return runGit(workingDir, "worktree", "add", worktreePath, branchName);
}

export async function gitWorktreeRemove(
  workingDir: string,
  worktreePath: string,
): Promise<string> {
  return runGit(workingDir, "worktree", "remove", worktreePath, "--force");
}

export async function gitWorktreeList(
  workingDir: string,
): Promise<string> {
  return runGit(workingDir, "worktree", "list");
}

export async function gitPush(workingDir: string, branchName: string): Promise<string> {
  return runGit(workingDir, "push", "-u", "origin", branchName);
}

export async function gitMerge(workingDir: string, branchName: string): Promise<string> {
  return runGit(workingDir, "merge", branchName, "--no-ff");
}

export async function gitFetch(workingDir: string): Promise<string> {
  return runGit(workingDir, "fetch", "origin");
}

export async function gitPushCurrentBranch(workingDir: string): Promise<string> {
  return runGit(workingDir, "push");
}

export async function runGh(workingDir: string, ...args: string[]): Promise<string> {
  return invoke<string>("run_gh_command", {
    args,
    workingDirectory: workingDir,
  });
}

export async function ghCreatePr(
  workingDir: string,
  title: string,
  body: string,
  baseBranch?: string,
): Promise<string> {
  const args = ["pr", "create", "--title", title, "--body", body];
  if (baseBranch) {
    args.push("--base", baseBranch);
  }
  return runGh(workingDir, ...args);
}

export function parsePrUrl(prUrl: string): { owner: string; repo: string; number: number } | null {
  const match = prUrl.match(/github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)/);
  if (!match) return null;
  return { owner: match[1], repo: match[2], number: parseInt(match[3], 10) };
}

export interface GhReview {
  id: number;
  state: string;
  body: string;
  user: { login: string; avatar_url: string };
}

export interface GhReviewComment {
  id: number;
  body: string;
  path: string;
  line: number | null;
  original_line: number | null;
  diff_hunk: string;
  user: { login: string; avatar_url: string };
}

export interface GhIssueComment {
  id: number;
  body: string;
  user: { login: string; avatar_url: string };
}

function parsePaginatedJson<T>(raw: string): T[] {
  try {
    return JSON.parse(raw);
  } catch {
    // gh --paginate may concatenate arrays: [...][...] — fix by wrapping
    const fixed = "[" + raw.replace(/\]\s*\[/g, ",") + "]";
    try {
      // The outer brackets make it [[...items...], but the replace joined them
      // Actually the replace turns "][" into "," so [1,2][3,4] becomes [1,2,3,4]
      return JSON.parse(fixed);
    } catch {
      return [];
    }
  }
}

export async function ghFetchPrReviews(
  workingDir: string,
  owner: string,
  repo: string,
  prNumber: number,
): Promise<GhReview[]> {
  const raw = await runGh(
    workingDir,
    "api",
    `repos/${owner}/${repo}/pulls/${prNumber}/reviews`,
    "--paginate",
  );
  return parsePaginatedJson<GhReview>(raw);
}

export async function ghFetchPrComments(
  workingDir: string,
  owner: string,
  repo: string,
  prNumber: number,
): Promise<GhReviewComment[]> {
  const raw = await runGh(
    workingDir,
    "api",
    `repos/${owner}/${repo}/pulls/${prNumber}/comments`,
    "--paginate",
  );
  return parsePaginatedJson<GhReviewComment>(raw);
}

export async function ghFetchPrIssueComments(
  workingDir: string,
  owner: string,
  repo: string,
  prNumber: number,
): Promise<GhIssueComment[]> {
  const raw = await runGh(
    workingDir,
    "api",
    `repos/${owner}/${repo}/issues/${prNumber}/comments`,
    "--paginate",
  );
  return parsePaginatedJson<GhIssueComment>(raw);
}

export interface GhPrState {
  state: "open" | "closed";
  merged: boolean;
}

export async function ghFetchPrState(
  workingDir: string,
  owner: string,
  repo: string,
  prNumber: number,
): Promise<GhPrState> {
  const raw = await runGh(
    workingDir,
    "api",
    `repos/${owner}/${repo}/pulls/${prNumber}`,
    "--jq", `{state: .state, merged: .merged}`,
  );
  return JSON.parse(raw);
}

export async function ghCommentOnPr(
  workingDir: string,
  owner: string,
  repo: string,
  prNumber: number,
  body: string,
): Promise<string> {
  return runGh(
    workingDir,
    "api",
    `repos/${owner}/${repo}/issues/${prNumber}/comments`,
    "-f", `body=${body}`,
  );
}

export async function readFileContents(path: string): Promise<string | null> {
  return invoke<string | null>("read_file_contents", { path });
}
