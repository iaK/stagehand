import {
  runGit,
  gitWorktreeAddDetached,
  gitMerge,
  gitMergeAbort,
  gitWorktreeRemove,
  gitRevParse,
  gitCurrentBranch,
  hasUncommittedChanges,
  gitStash,
  gitStashPop,
} from "./git";

/**
 * Merge the task branch into the target branch.
 *
 * Operates entirely locally — does not fetch from or push to any remote.
 *
 * When the target branch is checked out in the project root and the working
 * tree is clean, we perform a normal `git merge` directly — this is the
 * safest path and avoids any `reset --hard` that could lose content.
 *
 * When the target branch is NOT checked out (or the tree is dirty) we fall
 * back to an isolated detached-worktree merge and update the branch ref
 * via `update-ref`.  The working tree is intentionally left as-is so we
 * never discard uncommitted changes.
 *
 * Returns the SHA of the resulting merge commit.
 */
export type DirtyMergeStrategy = "update_ref" | "stash_merge_pop";

export async function performMerge(params: {
  projectPath: string;
  branchName: string;
  targetBranch: string;
  dirtyStrategy?: DirtyMergeStrategy;
}): Promise<string> {
  const { projectPath, branchName, targetBranch, dirtyStrategy = "update_ref" } = params;

  // Check if the target branch is checked out in the project root and clean.
  let targetIsCheckedOut = false;
  let workingTreeClean = false;
  try {
    const current = (await gitCurrentBranch(projectPath)).trim();
    targetIsCheckedOut = current === targetBranch;
    if (targetIsCheckedOut) {
      workingTreeClean = !(await hasUncommittedChanges(projectPath));
    }
  } catch { /* ignore */ }

  // ── Fast path: target branch is checked out and clean ──────────────
  // Perform a normal merge directly in the project root.  No detached
  // worktree, no update-ref, no reset — just a plain merge.
  if (targetIsCheckedOut && workingTreeClean) {
    await gitMerge(projectPath, branchName);
    return gitRevParse(projectPath, "HEAD");
  }

  // ── Dirty + stash strategy: stash changes, merge directly, pop ─────
  if (targetIsCheckedOut && !workingTreeClean && dirtyStrategy === "stash_merge_pop") {
    await gitStash(projectPath);
    try {
      await gitMerge(projectPath, branchName);
    } catch (mergeErr) {
      // Restore dirty changes before re-throwing
      await gitStashPop(projectPath).catch(() => {});
      throw mergeErr;
    }
    await gitStashPop(projectPath);
    return gitRevParse(projectPath, "HEAD");
  }

  // ── Fallback: isolated merge in a temporary detached worktree ──────
  // Used when target is not checked out, or target is dirty with
  // "update_ref" strategy (moves ref without touching working tree).
  const mergeWorktreePath = `${projectPath}/.stagehand-worktrees/_merge-${targetBranch.replace(/\//g, "--")}-${Date.now()}`;

  await gitWorktreeAddDetached(projectPath, mergeWorktreePath, targetBranch);

  try {
    await gitMerge(mergeWorktreePath, branchName);
  } catch (mergeErr) {
    try { await gitMergeAbort(mergeWorktreePath); } catch { /* ignore */ }
    try { await gitWorktreeRemove(projectPath, mergeWorktreePath); } catch { /* ignore */ }
    throw mergeErr;
  }

  // Capture the merge commit SHA before cleanup
  const mergeSha = await gitRevParse(mergeWorktreePath, "HEAD");

  // Point the target branch ref to the merge commit.
  // This is an atomic pointer update — it does NOT touch the working tree.
  await runGit(projectPath, "update-ref", `refs/heads/${targetBranch}`, mergeSha);

  // NOTE: When the target branch is checked out with dirty changes and
  // "update_ref" strategy is used, the branch pointer moves forward but
  // the working tree is left as-is. This means the next commit may
  // inadvertently revert the merged changes. Use "stash_merge_pop" to
  // avoid this.

  // Clean up the temporary merge worktree
  try { await gitWorktreeRemove(projectPath, mergeWorktreePath); } catch { /* ignore */ }

  return mergeSha;
}
