import {
  gitFetch,
  gitWorktreeAddDetached,
  gitMerge,
  gitMergeAbort,
  gitPushHeadTo,
  gitWorktreeRemove,
} from "./git";

/**
 * Perform a merge of the task branch into the target branch using a temporary
 * worktree. Pushes the result to origin and cleans up.
 */
export async function performMerge(params: {
  projectPath: string;
  branchName: string;
  targetBranch: string;
}): Promise<void> {
  const { projectPath, branchName, targetBranch } = params;

  // Use a temporary worktree to perform the merge so we don't
  // disturb the project root's checkout or any other worktrees.
  const mergeWorktreePath = `${projectPath}/.stagehand-worktrees/_merge-${targetBranch.replace(/\//g, "--")}-${Date.now()}`;

  // Fetch the latest target branch from remote before merging
  await gitFetch(projectPath, targetBranch);

  // Create a detached worktree at origin/<targetBranch>.
  // Using detached HEAD avoids "branch already checked out" errors
  // when the target branch is checked out in the main worktree.
  await gitWorktreeAddDetached(projectPath, mergeWorktreePath, `origin/${targetBranch}`);

  // Merge the task branch into the detached HEAD
  try {
    await gitMerge(mergeWorktreePath, branchName);
  } catch (mergeErr) {
    // Merge failed (e.g. conflict) — abort and clean up
    try {
      await gitMergeAbort(mergeWorktreePath);
    } catch {
      // Abort may fail if merge didn't start — ignore
    }
    try {
      await gitWorktreeRemove(projectPath, mergeWorktreePath);
    } catch {
      // Best-effort cleanup
    }
    throw mergeErr;
  }

  // Push the merged HEAD to the target branch on remote
  try {
    await gitPushHeadTo(mergeWorktreePath, targetBranch);
  } catch (pushErr) {
    // Push failed — clean up the temp worktree (merge is local only)
    try {
      await gitWorktreeRemove(projectPath, mergeWorktreePath);
    } catch {
      // Best-effort cleanup
    }
    throw pushErr;
  }

  // Clean up the temporary merge worktree
  try {
    await gitWorktreeRemove(projectPath, mergeWorktreePath);
  } catch {
    // Non-critical
  }
}
