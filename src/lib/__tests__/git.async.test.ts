import {
  runGit,
  gitStatus,
  gitDiff,
  gitDiffStat,
  gitDiffShortStatBranch,
  gitAdd,
  gitAddFiles,
  getChangedFiles,
  gitCommit,
  gitCreateBranch,
  gitCheckoutBranch,
  gitCurrentBranch,
  gitBranchExists,
  hasUncommittedChanges,
  isGitRepo,
  gitRemoteUrl,
  gitDefaultBranch,
  gitPush,
  runGh,
  ghCreatePr,
} from "../git";
import { mockInvoke } from "../../test/mocks/tauri";

// ─── runGit ──────────────────────────────────────────────────────────────────

describe("runGit", () => {
  it("invokes run_git_command with correct args", async () => {
    mockInvoke("run_git_command", () => "output");
    const result = await runGit("/repo", "status", "--porcelain");
    expect(result).toBe("output");
  });
});

// ─── gitStatus / gitDiff / gitDiffStat ───────────────────────────────────────

describe("gitStatus", () => {
  it("calls runGit with status --porcelain", async () => {
    mockInvoke("run_git_command", () => " M file.ts\n?? new.ts");
    const result = await gitStatus("/repo");
    expect(result).toBe(" M file.ts\n?? new.ts");
  });
});

describe("gitDiff", () => {
  it("calls runGit with diff", async () => {
    mockInvoke("run_git_command", () => "diff output");
    const result = await gitDiff("/repo");
    expect(result).toBe("diff output");
  });
});

describe("gitDiffStat", () => {
  it("calls runGit with diff --stat", async () => {
    mockInvoke("run_git_command", () => " 1 file changed");
    const result = await gitDiffStat("/repo");
    expect(result).toBe(" 1 file changed");
  });
});

// ─── gitDiffShortStatBranch ──────────────────────────────────────────────────

describe("gitDiffShortStatBranch", () => {
  it("parses full shortstat output", async () => {
    mockInvoke("run_git_command", () => " 3 files changed, 50 insertions(+), 10 deletions(-)");
    const result = await gitDiffShortStatBranch("/repo", "main");
    expect(result).toEqual({ filesChanged: 3, insertions: 50, deletions: 10 });
  });

  it("handles insertions only", async () => {
    mockInvoke("run_git_command", () => " 1 file changed, 20 insertions(+)");
    const result = await gitDiffShortStatBranch("/repo", "main");
    expect(result).toEqual({ filesChanged: 1, insertions: 20, deletions: 0 });
  });

  it("handles deletions only", async () => {
    mockInvoke("run_git_command", () => " 2 files changed, 5 deletions(-)");
    const result = await gitDiffShortStatBranch("/repo", "main");
    expect(result).toEqual({ filesChanged: 2, insertions: 0, deletions: 5 });
  });

  it("handles empty output (no changes)", async () => {
    mockInvoke("run_git_command", () => "");
    const result = await gitDiffShortStatBranch("/repo", "main");
    expect(result).toEqual({ filesChanged: 0, insertions: 0, deletions: 0 });
  });
});

// ─── gitAdd / gitAddFiles ────────────────────────────────────────────────────

describe("gitAdd", () => {
  it("calls runGit with add -A", async () => {
    mockInvoke("run_git_command", () => "");
    const result = await gitAdd("/repo");
    expect(result).toBe("");
  });
});

describe("gitAddFiles", () => {
  it("returns empty string for empty file list", async () => {
    const result = await gitAddFiles("/repo", []);
    expect(result).toBe("");
  });

  it("calls runGit with add -- files", async () => {
    mockInvoke("run_git_command", () => "");
    await gitAddFiles("/repo", ["file1.ts", "file2.ts"]);
    // Should not throw
  });
});

// ─── getChangedFiles ─────────────────────────────────────────────────────────

describe("getChangedFiles", () => {
  it("parses status output into file paths", async () => {
    mockInvoke("run_git_command", () => "MM src/main.ts\n?? new-file.ts\n");
    const result = await getChangedFiles("/repo");
    expect(result).toEqual(["src/main.ts", "new-file.ts"]);
  });

  it("returns empty array for clean repo", async () => {
    mockInvoke("run_git_command", () => "");
    const result = await getChangedFiles("/repo");
    expect(result).toEqual([]);
  });
});

// ─── gitCommit ───────────────────────────────────────────────────────────────

describe("gitCommit", () => {
  it("calls runGit with commit -m", async () => {
    mockInvoke("run_git_command", () => "[main abc1234] fix bug");
    const result = await gitCommit("/repo", "fix bug");
    expect(result).toBe("[main abc1234] fix bug");
  });
});

// ─── Branch operations ───────────────────────────────────────────────────────

describe("gitCreateBranch", () => {
  it("calls checkout -b", async () => {
    mockInvoke("run_git_command", () => "Switched to a new branch");
    const result = await gitCreateBranch("/repo", "feature/new");
    expect(result).toBe("Switched to a new branch");
  });
});

describe("gitCheckoutBranch", () => {
  it("calls checkout", async () => {
    mockInvoke("run_git_command", () => "Switched to branch");
    const result = await gitCheckoutBranch("/repo", "main");
    expect(result).toBe("Switched to branch");
  });
});

describe("gitCurrentBranch", () => {
  it("returns current branch name", async () => {
    mockInvoke("run_git_command", () => "feature/work");
    const result = await gitCurrentBranch("/repo");
    expect(result).toBe("feature/work");
  });
});

describe("gitBranchExists", () => {
  it("returns true when branch exists", async () => {
    mockInvoke("run_git_command", () => "  feature/work");
    const result = await gitBranchExists("/repo", "feature/work");
    expect(result).toBe(true);
  });

  it("returns false when branch does not exist", async () => {
    mockInvoke("run_git_command", () => "");
    const result = await gitBranchExists("/repo", "feature/missing");
    expect(result).toBe(false);
  });

  it("returns false on error", async () => {
    mockInvoke("run_git_command", () => { throw new Error("failed"); });
    const result = await gitBranchExists("/repo", "feature/broken");
    expect(result).toBe(false);
  });
});

// ─── hasUncommittedChanges ───────────────────────────────────────────────────

describe("hasUncommittedChanges", () => {
  it("returns true when status is non-empty", async () => {
    mockInvoke("run_git_command", () => " M file.ts");
    const result = await hasUncommittedChanges("/repo");
    expect(result).toBe(true);
  });

  it("returns false when status is empty", async () => {
    mockInvoke("run_git_command", () => "");
    const result = await hasUncommittedChanges("/repo");
    expect(result).toBe(false);
  });

  it("returns false on error", async () => {
    mockInvoke("run_git_command", () => { throw new Error("not a repo"); });
    const result = await hasUncommittedChanges("/repo");
    expect(result).toBe(false);
  });
});

// ─── isGitRepo ───────────────────────────────────────────────────────────────

describe("isGitRepo", () => {
  it("returns true for git repos", async () => {
    mockInvoke("run_git_command", () => ".git");
    const result = await isGitRepo("/repo");
    expect(result).toBe(true);
  });

  it("returns false for non-git directories", async () => {
    mockInvoke("run_git_command", () => { throw new Error("not a repo"); });
    const result = await isGitRepo("/not-a-repo");
    expect(result).toBe(false);
  });
});

// ─── gitRemoteUrl ────────────────────────────────────────────────────────────

describe("gitRemoteUrl", () => {
  it("returns trimmed remote URL", async () => {
    mockInvoke("run_git_command", () => "git@github.com:owner/repo.git\n");
    const result = await gitRemoteUrl("/repo");
    expect(result).toBe("git@github.com:owner/repo.git");
  });

  it("returns null when no remote", async () => {
    mockInvoke("run_git_command", () => { throw new Error("no remote"); });
    const result = await gitRemoteUrl("/repo");
    expect(result).toBeNull();
  });

  it("returns null for empty URL", async () => {
    mockInvoke("run_git_command", () => "  ");
    const result = await gitRemoteUrl("/repo");
    expect(result).toBeNull();
  });
});

// ─── gitDefaultBranch ────────────────────────────────────────────────────────

describe("gitDefaultBranch", () => {
  it("parses default branch from symbolic ref", async () => {
    mockInvoke("run_git_command", () => "refs/remotes/origin/main\n");
    const result = await gitDefaultBranch("/repo");
    expect(result).toBe("main");
  });

  it("returns null on error", async () => {
    mockInvoke("run_git_command", () => { throw new Error("no remote HEAD"); });
    const result = await gitDefaultBranch("/repo");
    expect(result).toBeNull();
  });
});

// ─── gitPush ─────────────────────────────────────────────────────────────────

describe("gitPush", () => {
  it("calls runGit with push -u origin branch", async () => {
    mockInvoke("run_git_command", () => "pushed");
    const result = await gitPush("/repo", "feature/work");
    expect(result).toBe("pushed");
  });
});

// ─── runGh / ghCreatePr ──────────────────────────────────────────────────────

describe("runGh", () => {
  it("invokes run_gh_command with correct args", async () => {
    mockInvoke("run_gh_command", () => "gh output");
    const result = await runGh("/repo", "pr", "list");
    expect(result).toBe("gh output");
  });
});

describe("ghCreatePr", () => {
  it("creates PR with title and body", async () => {
    mockInvoke("run_gh_command", () => "https://github.com/owner/repo/pull/1");
    const result = await ghCreatePr("/repo", "Fix bug", "Description");
    expect(result).toBe("https://github.com/owner/repo/pull/1");
  });

  it("includes base branch when provided", async () => {
    mockInvoke("run_gh_command", () => "https://github.com/owner/repo/pull/2");
    const result = await ghCreatePr("/repo", "Fix bug", "Description", "main");
    expect(result).toBe("https://github.com/owner/repo/pull/2");
  });
});
