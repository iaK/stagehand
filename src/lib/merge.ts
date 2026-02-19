import {
  runGit,
  gitFetch,
  gitWorktreeAddDetached,
  gitMerge,
  gitMergeAbort,
  gitPushHeadTo,
  gitWorktreeRemove,
  gitHasRemote,
  gitRevParse,
  gitCurrentBranch,
  hasUncommittedChanges,
} from "./git";

/**
 * Merge the task branch into the target branch.
 *
 * Works with or without an `origin` remote:
 *   - With remote: fetches latest, merges, pushes, updates local ref.
 *   - Without remote: merges into the local target branch directly.
 *
 * Uses a temporary detached worktree so the project root's checkout is not
 * disturbed during the merge itself.
 *
 * Returns the SHA of the resulting merge commit.
 */
export async function performMerge(params: {
  projectPath: string;
  branchName: string;
  targetBranch: string;
}): Promise<string> {
  const { projectPath, branchName, targetBranch } = params;

  const hasRemote = await gitHasRemote(projectPath);

  // Determine starting point for the merge
  let startPoint: string;
  if (hasRemote) {
    await gitFetch(projectPath, targetBranch);
    startPoint = `origin/${targetBranch}`;
  } else {
    startPoint = targetBranch;
  }

  // Use a temporary worktree to perform the merge so we don't
  // disturb the project root's checkout or any other worktrees.
  const mergeWorktreePath = `${projectPath}/.stagehand-worktrees/_merge-${targetBranch.replace(/\//g, "--")}-${Date.now()}`;

  await gitWorktreeAddDetached(projectPath, mergeWorktreePath, startPoint);

  // Merge the task branch into the detached HEAD
  try {
    await gitMerge(mergeWorktreePath, branchName);
  } catch (mergeErr) {
    try { await gitMergeAbort(mergeWorktreePath); } catch { /* ignore */ }
    try { await gitWorktreeRemove(projectPath, mergeWorktreePath); } catch { /* ignore */ }
    throw mergeErr;
  }

  // Capture the merge commit SHA before any cleanup
  const mergeSha = await gitRevParse(mergeWorktreePath, "HEAD");

  // Push to remote if applicable
  if (hasRemote) {
    try {
      await gitPushHeadTo(mergeWorktreePath, targetBranch);
    } catch (pushErr) {
      try { await gitWorktreeRemove(projectPath, mergeWorktreePath); } catch { /* ignore */ }
      throw pushErr;
    }
  }

  // Check if target branch is checked out and clean BEFORE updating the ref,
  // so we know whether it's safe to reset the working tree afterward.
  let shouldResetWorkingTree = false;
  try {
    const current = (await gitCurrentBranch(projectPath)).trim();
    if (current === targetBranch) {
      shouldResetWorkingTree = !(await hasUncommittedChanges(projectPath));
    }
  } catch { /* ignore */ }

  // Update the local target branch ref to the merge commit
  try {
    await runGit(projectPath, "update-ref", `refs/heads/${targetBranch}`, mergeSha);
  } catch { /* non-critical if push already succeeded */ }

  // If the target branch is checked out in the project root and was clean,
  // sync the working tree to match the new ref.
  if (shouldResetWorkingTree) {
    try {
      await runGit(projectPath, "reset", "--hard");
    } catch { /* non-critical */ }
  }

  // Clean up the temporary merge worktree
  try { await gitWorktreeRemove(projectPath, mergeWorktreePath); } catch { /* ignore */ }

  return mergeSha;
}
