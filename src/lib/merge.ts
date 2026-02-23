import {
  runGit,
  gitWorktreeAddDetached,
  gitMerge,
  gitMergeAbort,
  gitWorktreeRemove,
  gitRevParse,
  gitCurrentBranch,
  hasUncommittedChanges,
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
export async function performMerge(params: {
  projectPath: string;
  branchName: string;
  targetBranch: string;
}): Promise<string> {
  const { projectPath, branchName, targetBranch } = params;

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

  // ── Fallback: isolated merge in a temporary detached worktree ──────
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

  // Intentionally do NOT run `git reset --hard` here.  If the user has
  // the target branch checked out with uncommitted work we must not
  // discard it.  The ref update is enough — the next time they run
  // `git status` they'll see the updated branch.

  // Clean up the temporary merge worktree
  try { await gitWorktreeRemove(projectPath, mergeWorktreePath); } catch { /* ignore */ }

  return mergeSha;
}
