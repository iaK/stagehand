import type { Task } from "./types";

/**
 * Returns the working directory for a task: the worktree path if set,
 * otherwise falls back to the project path (backwards compatibility).
 */
export function getTaskWorkingDir(task: Task, projectPath: string): string {
  return task.worktree_path ?? projectPath;
}
