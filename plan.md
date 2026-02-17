# Implementation Plan: Dynamic Stages Per Task

## Overview

Add the ability for each task to have a custom subset of pipeline stages. The Research stage always runs first and suggests which subsequent stages are needed. The user confirms/modifies the selection before advancing, and only selected stages execute.

---

## Step 1: Database — Create `task_stages` Junction Table

**File: `src/lib/db.ts`**

Add to `initProjectSchema()` (after the `settings` table creation, ~line 129):

```sql
CREATE TABLE IF NOT EXISTS task_stages (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL,
  stage_template_id TEXT NOT NULL,
  sort_order INTEGER NOT NULL,
  FOREIGN KEY (task_id) REFERENCES tasks(id),
  FOREIGN KEY (stage_template_id) REFERENCES stage_templates(id),
  UNIQUE(task_id, stage_template_id)
)
```

This table stores which stages a task uses and in what order. When empty for a task, all stages are used (backward compatibility).

---

## Step 2: Types — Extend `ResearchOutput`

**File: `src/lib/types.ts`**

Add `suggested_stages` to the `ResearchOutput` interface (~line 138):

```typescript
export interface ResearchOutput {
  research: string;
  questions: ResearchQuestion[];
  suggested_stages?: StageSuggestion[];
}

export interface StageSuggestion {
  name: string;
  reason: string;
}
```

The AI returns stage names (not IDs) with reasons. Name-to-ID mapping happens at the UI layer.

---

## Step 3: Repository Functions — CRUD for Task Stages

**File: `src/lib/repositories.ts`**

Add three new functions:

### `getTaskStages(projectId, taskId)`
Returns the `stage_template_id` list for a task, ordered by `sort_order`. Returns empty array if no rows exist (legacy tasks).

### `setTaskStages(projectId, taskId, stages: { stageTemplateId: string, sortOrder: number }[])`
Replaces all task stage records: DELETE existing rows for this task, then INSERT new ones in a transaction.

### `getFilteredStageTemplates(projectId, taskId, allTemplates)`
Loads `task_stages` for the task. If rows exist, filters and reorders `allTemplates` to only include selected stages. If no rows, returns all templates unchanged.

### Modify `getPreviousStageExecution()` (~line 358)

**Current logic** (line 366-367):
```typescript
const previousTemplate = stageTemplates.find(
  (t) => t.sort_order === currentSortOrder - 1,
);
```

**New logic**: Instead of `sort_order - 1`, find the template in the provided `stageTemplates` array with the highest `sort_order` that is less than `currentSortOrder`. The caller will pass the already-filtered template list (only selected stages), so "previous" naturally means the previous *selected* stage:

```typescript
const previousTemplate = stageTemplates
  .filter((t) => t.sort_order < currentSortOrder)
  .sort((a, b) => b.sort_order - a.sort_order)[0] ?? null;
```

This handles non-contiguous sort_order values (e.g., stages 0, 2, 3, 6 when 1, 4, 5 are skipped).

---

## Step 4: Update Research Prompt and Schema

**File: `src/lib/db.ts`** — Update `RESEARCH_PROMPT` (~line 158) and `RESEARCH_SCHEMA` (~line 192)

### Prompt changes
Append to the Research prompt (before the JSON example):

```
Additionally, suggest which pipeline stages this task needs. The available stages are:
- "High-Level Approaches": Brainstorm and compare multiple approaches (useful for complex tasks with multiple viable solutions)
- "Planning": Create a detailed implementation plan (useful for non-trivial changes)
- "Implementation": Write the actual code changes (almost always needed)
- "Refinement": Self-review the implementation for quality issues (useful for larger changes)
- "Security Review": Check for security vulnerabilities (useful when dealing with auth, user input, APIs, or data handling)
- "PR Preparation": Prepare a pull request with title and description (useful when changes will be submitted as a PR)

For simple bug fixes, you might only need Implementation. For large features, you might need all stages.
Include your suggestions in the "suggested_stages" array.
```

Update the JSON example to include:
```json
"suggested_stages": [
  { "name": "Implementation", "reason": "Code changes are needed" },
  { "name": "PR Preparation", "reason": "Changes should be submitted as a PR" }
]
```

### Schema changes
Add `suggested_stages` to `RESEARCH_SCHEMA`:
```json
"suggested_stages": {
  "type": "array",
  "items": {
    "type": "object",
    "properties": {
      "name": { "type": "string" },
      "reason": { "type": "string" }
    },
    "required": ["name", "reason"]
  }
}
```

Keep `suggested_stages` out of the `required` array so existing Research stages still parse correctly.

**File: `src/lib/seed.ts`** — Update the seed template's prompt and schema to match. Same changes as above applied to the Research entry (~line 14-77).

### Migration
Add a new migration function `migrateResearchStageSuggestions()` in `db.ts` (similar to existing `migrateResearchStage()`). Detect Research stages whose schema doesn't include `"suggested_stages"` and update their `prompt_template` and `output_schema` to the new versions. Call it from `initProjectSchema()`.

---

## Step 5: Task Store — Track Task Stages

**File: `src/stores/taskStore.ts`**

Add to the store interface and implementation:

```typescript
taskStages: Record<string, string[]>;  // taskId → stageTemplateId[]
loadTaskStages: (projectId: string, taskId: string) => Promise<void>;
setTaskStages: (projectId: string, taskId: string, stages: { stageTemplateId: string, sortOrder: number }[]) => Promise<void>;
getActiveTaskStageTemplates: () => StageTemplate[];
```

- `loadTaskStages`: Calls `repo.getTaskStages()` and stores the result keyed by task ID.
- `setTaskStages`: Calls `repo.setTaskStages()` and updates local state.
- `getActiveTaskStageTemplates`: Returns `stageTemplates` filtered by the active task's `taskStages`. If the active task has no entries in `taskStages`, returns all `stageTemplates` (backward compatibility). Research (sort_order 0) is always included.

Load task stages in `loadExecutions` (already called when task changes) or add a separate effect in `PipelineView`.

---

## Step 6: ResearchOutput — Add Stage Selection UI

**File: `src/components/output/ResearchOutput.tsx`**

### Props changes
Add new props:
```typescript
interface ResearchOutputProps {
  output: string;
  onApprove: () => void;
  onApproveWithStages?: (selectedStageIds: string[]) => void;
  onSubmitAnswers: (answers: string) => void;
  isApproved: boolean;
  stageTemplates?: StageTemplate[];
}
```

### UI changes
When `questions.length === 0` and `!isApproved` (the approval section, ~line 55-66), replace the simple "Approve & Continue" button with a stage selection panel:

1. Parse `suggested_stages` from the research output JSON
2. Map AI-suggested stage names to actual `StageTemplate` objects (case-insensitive match, trimmed)
3. Render checkboxes for all non-Research stages:
   - Research: always checked, disabled (grayed out, always included)
   - Other stages: pre-checked if the AI suggested them, toggleable by user
   - Each checkbox shows the stage name and the AI's reason as a tooltip or small description
4. "Approve & Continue" button calls `onApproveWithStages` with the IDs of all checked stages (including Research)

If `stageTemplates` is not provided or `suggested_stages` is absent in the output, fall back to the current simple "Approve & Continue" behavior (calls `onApprove()` with no stage selection — all stages used).

### Stage name matching
Use normalized comparison: `template.name.trim().toLowerCase() === suggestion.name.trim().toLowerCase()`. If a suggested name doesn't match any template, ignore it (don't crash). If no suggestions match, default to all stages checked.

---

## Step 7: Thread Props Through StageOutput and StageView

**File: `src/components/pipeline/StageOutput.tsx`**

In the `research` case (~line 72-80), pass `stageTemplates` and `onApproveWithStages` through to `ResearchOutput`:

```typescript
case "research":
  return (
    <ResearchOutput
      output={output}
      onApprove={() => onApprove()}
      onApproveWithStages={onApproveWithStages}
      onSubmitAnswers={onSubmitAnswers ?? (() => {})}
      isApproved={isApproved}
      stageTemplates={stageTemplates}
    />
  );
```

Add `stageTemplates` and `onApproveWithStages` to `StageOutputProps`.

**File: `src/components/pipeline/StageView.tsx`**

Add a new handler `handleApproveWithStages` that:
1. Calls `approveStage(activeTask, stage)` (same as current approve)
2. Calls the store's `setTaskStages()` to persist the selected stages

Pass `stageTemplates` and `handleApproveWithStages` into `StageOutput`.

---

## Step 8: Modify Stage Advancement Logic

**File: `src/hooks/useStageExecution.ts`**

### `approveStage()` (~line 404-417)

**Current** (line 405-406):
```typescript
const nextStage = stageTemplates.find(
  (s) => s.sort_order === stage.sort_order + 1,
);
```

**New**: Load the task's selected stages. Find the next stage among selected stages (the one with the lowest `sort_order` greater than the current stage's `sort_order`):

```typescript
const taskStageTemplates = await repo.getFilteredStageTemplates(
  activeProject.id, task.id, stageTemplates
);
const nextStage = taskStageTemplates
  .filter((s) => s.sort_order > stage.sort_order)
  .sort((a, b) => a.sort_order - b.sort_order)[0] ?? null;
```

If `nextStage` exists, advance to it. Otherwise, mark task complete.

### `runStage()` (~line 82-87)

The call to `getPreviousStageExecution()` already passes `stageTemplates`. Change it to pass the filtered templates instead:

```typescript
const taskStageTemplates = await repo.getFilteredStageTemplates(
  activeProject.id, task.id, stageTemplates
);
const prevExec = await repo.getPreviousStageExecution(
  activeProject.id, task.id, stage.sort_order, taskStageTemplates,
);
```

### Branch creation check (~line 36)
Currently uses `stage.sort_order === 0`. This is fine — Research is always sort_order 0 and always included.

---

## Step 9: Filter Stages in PipelineView

**File: `src/components/pipeline/PipelineView.tsx`**

After loading executions (~line 22-25), also load task stages. Use the store's `getActiveTaskStageTemplates()` to get the filtered list:

```typescript
const filteredStages = useTaskStore((s) => s.getActiveTaskStageTemplates());
```

Pass `filteredStages` to `PipelineStepper` instead of `stageTemplates`:

```typescript
<PipelineStepper
  stages={filteredStages}
  currentStageId={activeTask.current_stage_id}
  executions={executions}
  onStageClick={setViewingStage}
/>
```

Also use `filteredStages` for the auto-select effect (~line 28-37).

**Important**: Before Research is approved (no `task_stages` rows yet), `filteredStages` returns all stages. After Research approval with stage selection, it returns only the selected stages. The stepper re-renders automatically when the store updates.

---

## Step 10: Handle Edge Cases

### Re-running Research after stages selected
In `redoStage()` or at the start of `runStage()` when `stage.sort_order === 0`, clear existing `task_stages` rows for this task. The new Research output will produce a fresh `suggested_stages` and the user will re-select.

### Legacy tasks (no `task_stages` rows)
`getFilteredStageTemplates()` returns all templates when no rows exist. All existing code paths remain unchanged. No data migration needed for existing tasks.

### Deleted stage templates
`getFilteredStageTemplates()` filters `task_stages` entries against the current `stageTemplates` list. Any `task_stages` row referencing a deleted template is silently excluded.

### `input_source: "previous_stage"` with skipped stages
If High-Level Approaches (sort_order 1) is skipped, Planning (sort_order 2) needs input from Research (sort_order 0). The updated `getPreviousStageExecution()` finds the previous *selected* stage's execution, which would be Research. This works correctly.

### Task completion detection
When the last selected stage is approved, `nextStage` will be null, and the task is marked complete. This works naturally with the filtered list.

---

## Files Summary

| File | Action | Changes |
|------|--------|---------|
| `src/lib/db.ts` | Modify | Add `task_stages` table; update `RESEARCH_PROMPT` and `RESEARCH_SCHEMA`; add migration function |
| `src/lib/types.ts` | Modify | Add `StageSuggestion` interface; extend `ResearchOutput` |
| `src/lib/repositories.ts` | Modify | Add `getTaskStages()`, `setTaskStages()`, `getFilteredStageTemplates()`; fix `getPreviousStageExecution()` |
| `src/lib/seed.ts` | Modify | Update Research template prompt and schema |
| `src/stores/taskStore.ts` | Modify | Add `taskStages` state, `loadTaskStages()`, `setTaskStages()`, `getActiveTaskStageTemplates()` |
| `src/components/output/ResearchOutput.tsx` | Modify | Add stage selection UI (checkboxes + reasons) |
| `src/components/pipeline/StageOutput.tsx` | Modify | Pass `stageTemplates` and `onApproveWithStages` to ResearchOutput |
| `src/components/pipeline/StageView.tsx` | Modify | Add `handleApproveWithStages` handler; pass new props to StageOutput |
| `src/hooks/useStageExecution.ts` | Modify | Update `approveStage()` and `runStage()` to use filtered stages |
| `src/components/pipeline/PipelineView.tsx` | Modify | Use filtered stages for stepper and auto-select |

No new files need to be created.

---

## Implementation Order

1. **Types** (`types.ts`) — Add interfaces first, no dependencies
2. **Database** (`db.ts`) — Create table + update prompt/schema + migration
3. **Seed** (`seed.ts`) — Update default template to match new prompt/schema
4. **Repository** (`repositories.ts`) — Add CRUD functions + fix `getPreviousStageExecution`
5. **Store** (`taskStore.ts`) — Add state management for task stages
6. **ResearchOutput** (`ResearchOutput.tsx`) — Build the stage selection UI
7. **StageOutput** (`StageOutput.tsx`) — Thread new props through
8. **StageView** (`StageView.tsx`) — Add handler for approve-with-stages
9. **useStageExecution** (`useStageExecution.ts`) — Update advancement logic
10. **PipelineView** (`PipelineView.tsx`) — Filter stages for stepper

---

## Testing Strategy

### Manual Testing
1. **New task**: Create a task, run Research. Verify `suggested_stages` appears in output. Toggle stages, approve. Verify stepper shows only selected stages. Run through remaining stages and verify advancement works.
2. **Legacy task**: Open an existing task with no `task_stages` rows. Verify all stages appear and advancement works as before.
3. **Redo Research**: After selecting stages, redo Research. Verify old selections are cleared and new suggestions appear.
4. **Skip non-adjacent stages**: Select Research → Implementation → PR Preparation (skipping 3 stages). Verify Implementation receives Research output correctly.
5. **All stages selected**: Select all stages. Verify behavior identical to current.
6. **Single stage**: Select only Research (if possible — Research is mandatory). After Research approval, task should complete.
7. **Stage name mismatch**: Manually edit a prompt to return a misspelled stage name. Verify it's silently ignored and the checkbox isn't pre-checked.

### What to Watch For
- Stage stepper pill numbering adjusts to show 1, 2, 3... for the filtered list
- `current_stage_id` correctly points to the next selected stage after approval
- `stage_result` chain is correct when stages are skipped (e.g., Planning gets Research's result when High-Level Approaches is skipped)
- Task completion triggers when the last selected stage is approved
- Process store (terminal view) correctly maps to the right stage outputs

---

## Risks and Mitigations

| Risk | Mitigation |
|------|-----------|
| AI returns stage names that don't match templates | Normalized case-insensitive comparison + silent fallback to all stages |
| User approves Research before `task_stages` is saved | `onApproveWithStages` saves stages atomically before calling `approveStage` |
| Re-running Research creates stale `task_stages` | Clear `task_stages` at start of Research re-run |
| Filtered stage list not ready when stepper renders | Default to all stages when `taskStages` is empty/loading |
| `getPreviousStageExecution` returns wrong stage | Updated to use filtered list with `sort_order <` comparison instead of `sort_order - 1` |
