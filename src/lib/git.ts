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

export async function gitListBranches(workingDir: string): Promise<string[]> {
  try {
    const local = await runGit(workingDir, "branch", "--format=%(refname:short)");
    const remote = await runGit(workingDir, "branch", "-r", "--format=%(refname:short)");
    const seen = new Set<string>();
    const branches: string[] = [];
    for (const raw of [...local.split("\n"), ...remote.split("\n")]) {
      const name = raw.trim().replace(/^origin\//, "");
      if (name && name !== "HEAD" && !seen.has(name)) {
        seen.add(name);
        branches.push(name);
      }
    }
    return branches.sort();
  } catch {
    return [];
  }
}

export async function gitBranchExists(workingDir: string, name: string): Promise<boolean> {
  try {
    const result = await runGit(workingDir, "branch", "--list", name);
    return result.trim().length > 0;
  } catch {
    return false;
  }
}

export async function gitDeleteBranch(workingDir: string, branchName: string): Promise<string> {
  return runGit(workingDir, "branch", "-D", branchName);
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
    return parseGitLogOutput(raw, delimiter);
  } catch {
    return [];
  }
}

/**
 * Returns only the commits on the current branch that are not on `baseBranch`.
 * Uses `git log baseBranch..HEAD`.
 */
export async function gitLogBranchDiff(
  workingDir: string,
  baseBranch: string,
  maxCount: number = 200,
): Promise<GitCommit[]> {
  try {
    const delimiter = "---END-COMMIT---";
    const raw = await runGit(
      workingDir,
      "log",
      `${baseBranch}..HEAD`,
      `--max-count=${maxCount}`,
      `--format=%H%n%s%n%aI%n%an%n${delimiter}`,
    );
    return parseGitLogOutput(raw, delimiter);
  } catch {
    // Fallback to regular log if the base branch doesn't exist locally
    return gitLog(workingDir, maxCount);
  }
}

function parseGitLogOutput(raw: string, delimiter: string): GitCommit[] {
  return raw
    .trim()
    .split(`${delimiter}\n`)
    .filter((block) => block.trim())
    .map((block) => {
      const [hash, message, date, author] = block.trim().split("\n");
      return { hash, message, date, author };
    });
}

export async function gitDefaultBranch(workingDir: string): Promise<string | null> {
  try {
    const ref = await runGit(workingDir, "symbolic-ref", "refs/remotes/origin/HEAD");
    // Returns e.g. "refs/remotes/origin/main"
    const branch = ref.trim().replace("refs/remotes/origin/", "");
    if (branch) return branch;
  } catch {
    // origin/HEAD not set — fall through to check common branch names
  }

  // Try common default branch names via remote refs first, then local refs
  for (const candidate of ["main", "master"]) {
    try {
      await runGit(workingDir, "rev-parse", "--verify", `refs/remotes/origin/${candidate}`);
      return candidate;
    } catch {
      // Remote branch doesn't exist — try local
    }
    try {
      await runGit(workingDir, "rev-parse", "--verify", `refs/heads/${candidate}`);
      return candidate;
    } catch {
      // Local branch doesn't exist either — try next
    }
  }

  return null;
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

export async function gitWorktreeAddDetached(
  workingDir: string,
  worktreePath: string,
  commitish: string,
): Promise<string> {
  return runGit(workingDir, "worktree", "add", "--detach", worktreePath, commitish);
}

export async function gitPushHeadTo(
  workingDir: string,
  remoteBranch: string,
): Promise<string> {
  return runGit(workingDir, "push", "origin", `HEAD:${remoteBranch}`);
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

export async function gitFetch(workingDir: string, branch?: string): Promise<string> {
  if (branch) {
    return runGit(workingDir, "fetch", "origin", branch);
  }
  return runGit(workingDir, "fetch", "origin");
}

export async function gitPull(workingDir: string): Promise<string> {
  return runGit(workingDir, "pull");
}

export async function gitMergeAbort(workingDir: string): Promise<string> {
  return runGit(workingDir, "merge", "--abort");
}

export async function gitPushCurrentBranch(workingDir: string): Promise<string> {
  return runGit(workingDir, "push");
}

/** Check whether an `origin` remote is configured. */
export async function gitHasRemote(workingDir: string): Promise<boolean> {
  return (await gitRemoteUrl(workingDir)) !== null;
}

/** Resolve a ref to its SHA. */
export async function gitRevParse(workingDir: string, ref: string): Promise<string> {
  const sha = await runGit(workingDir, "rev-parse", ref);
  return sha.trim();
}

/** Return true if `branch` has been fully merged into `into`. */
export async function gitIsMerged(workingDir: string, branch: string, into: string): Promise<boolean> {
  try {
    await runGit(workingDir, "merge-base", "--is-ancestor", branch, into);
    return true;
  } catch {
    return false;
  }
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

export async function gitDiffNameOnly(workingDir: string, base: string, head?: string): Promise<string[]> {
  const ref = head ? `${base}...${head}` : `${base}...HEAD`;
  const result = await runGit(workingDir, "diff", "--name-only", ref);
  return result.trim().split("\n").filter((l) => l.length > 0);
}

export async function gitDiffStatBranch(workingDir: string, base: string): Promise<string> {
  return runGit(workingDir, "diff", "--stat", `${base}...HEAD`);
}

export async function readFileContents(path: string): Promise<string | null> {
  return invoke<string | null>("read_file_contents", { path });
}
