# Merge Conflict Detection

## Problem

When multiple tasks run concurrently on separate branches, they can modify the same files without any warning. Conflicts are only discovered at merge time, after the work is already done.

**Example**: `feature/integrated-terminal` and `feature/monaco-editor-in-tasks` both branched from the same commit and both modified `PipelineView.tsx`. Monaco was merged first, and the integrated-terminal merge then hit conflicts with no prior warning.

Currently `src/lib/merge.ts` performs the merge and throws on failure. `MergeStageView.tsx` shows a reactive "Merge conflicts detected" message, but nothing warns you *before* you get there.

## Proposed Solutions

### 1. Pre-merge dry-run check

Before performing the actual merge, run `git merge --no-commit --no-ff` in a temporary worktree to detect conflicts ahead of time. If conflicts are found, show a warning with the affected files and let the user decide whether to proceed, resolve first, or abort.

- Add to the merge stage UI, before the merge button is clicked
- Low effort, catches conflicts right before they happen

### 2. Proactive file overlap warnings across active tasks

Compare changed file lists across all in-progress task branches (using `git diff --name-only` against their common ancestor). Surface warnings in the task list or pipeline view when two or more active branches touch the same files.

- Could run periodically or on-demand
- Warns early, while work is still in progress — gives you a chance to coordinate
- More complex: needs to track which branches are active and compare their diffs

### 3. Merge order suggestions

When multiple tasks are ready to merge, suggest an optimal merge order based on file overlap — merge the task with the fewest overlapping files first to minimize cascading conflicts.
