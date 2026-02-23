import type { Task } from "./types";
import {
  gitWorktreeRemove,
  gitDeleteBranch,
  gitDefaultBranch,
  gitCheckoutBranch,
} from "./git";

/**
 * Returns the working directory for a task: the worktree path if set,
 * otherwise falls back to the project path (backwards compatibility).
 */
export function getTaskWorkingDir(task: Task, projectPath: string): string {
  return task.worktree_path ?? projectPath;
}

export interface CleanupWorktreeOptions {
  deleteBranch?: boolean;
}

/**
 * Cleans up a task's worktree and optionally deletes its branch.
 *
 * For ejected tasks (no worktree), checks out the default branch first
 * so the task branch can be safely deleted.
 *
 * All operations are best-effort — failures are silently ignored.
 */
export async function cleanupTaskWorktree(
  projectPath: string,
  task: Pick<Task, "worktree_path" | "branch_name" | "ejected">,
  options?: CleanupWorktreeOptions,
): Promise<void> {
  const { deleteBranch = false } = options ?? {};

  // Ejected tasks run in the main project directory — checkout the default
  // branch so the task branch can be deleted.
  if (task.ejected && !task.worktree_path) {
    try {
      const defaultBranch = await gitDefaultBranch(projectPath);
      await gitCheckoutBranch(projectPath, defaultBranch ?? "main");
    } catch {
      // Non-critical
    }
  }

  // Remove the worktree directory
  if (task.worktree_path) {
    try {
      await gitWorktreeRemove(projectPath, task.worktree_path);
    } catch {
      // Non-critical — worktree may already be gone
    }
  }

  // Delete the branch if requested
  if (deleteBranch && task.branch_name) {
    try {
      await gitDeleteBranch(projectPath, task.branch_name);
    } catch {
      // Non-critical — branch may already be gone
    }
  }
}
