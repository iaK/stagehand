import { create } from "zustand";
import type { Task, StageTemplate, StageExecution, TaskStageInstance } from "../lib/types";
import * as repo from "../lib/repositories";
import { listProcessesDetailed, type ProcessInfo } from "../lib/agent";
import { useProcessStore, stageKey } from "./processStore";
import { useProjectStore } from "./projectStore";
import { logger } from "../lib/logger";

const INITIAL_INPUT_PREFIX = "stagehand:initialInput:";

function setInitialInput(taskId: string, value: string): void {
  try { localStorage.setItem(`${INITIAL_INPUT_PREFIX}${taskId}`, value); } catch {}
}

function consumeInitialInputFromStorage(taskId: string): string | undefined {
  const key = `${INITIAL_INPUT_PREFIX}${taskId}`;
  try {
    const value = localStorage.getItem(key);
    if (value !== null) {
      localStorage.removeItem(key);
      return value;
    }
  } catch {}
  return undefined;
}

interface TaskStore {
  tasks: Task[];
  activeTask: Task | null;
  stageTemplates: StageTemplate[];
  executions: StageExecution[];
  loading: boolean;
  taskStages: Record<string, TaskStageInstance[]>; // taskId → instances
  taskExecStatuses: Record<string, string>; // taskId → latest execution status

  loadTasks: (projectId: string) => Promise<void>;
  loadStageTemplates: (projectId: string) => Promise<void>;
  loadExecutions: (projectId: string, taskId: string) => Promise<void>;
  loadTaskStages: (projectId: string, taskId: string) => Promise<void>;
  setTaskStages: (projectId: string, taskId: string, stages: { stageTemplateId: string; sortOrder: number }[]) => Promise<void>;
  insertTaskStage: (projectId: string, taskId: string, templateId: string, sortOrder: number, agent?: string | null, model?: string | null) => Promise<void>;
  renumberTaskStages: (projectId: string, taskId: string) => Promise<void>;
  getActiveTaskStageInstances: () => TaskStageInstance[];
  setActiveTask: (task: Task | null) => void;
  consumeInitialInput: (taskId: string) => string | undefined;
  addTask: (
    projectId: string,
    title: string,
    initialInput?: string,
    branchName?: string,
  ) => Promise<Task>;
  updateTask: (
    projectId: string,
    taskId: string,
    updates: Partial<Pick<Task, "current_stage_id" | "status" | "title" | "lifecycle" | "branch_name" | "worktree_path" | "pr_url" | "ejected">>,
  ) => Promise<void>;
  refreshExecution: (
    projectId: string,
    executionId: string,
  ) => Promise<void>;
  refreshTaskExecStatuses: (projectId: string) => Promise<void>;
  createStageTemplate: (projectId: string, template: Omit<StageTemplate, "id" | "created_at" | "updated_at">) => Promise<StageTemplate>;
  deleteStageTemplate: (projectId: string, templateId: string) => Promise<void>;
  reorderStageTemplates: (projectId: string, orderedIds: string[]) => Promise<void>;
  duplicateStageTemplate: (projectId: string, templateId: string) => Promise<StageTemplate>;
  createSubtasks: (projectId: string, parentTaskId: string, subtasks: { title: string; initialInput?: string }[]) => Promise<Task[]>;
}

export const useTaskStore = create<TaskStore>((set, get) => ({
  tasks: [],
  activeTask: null,
  stageTemplates: [],
  executions: [],
  loading: false,
  taskStages: {},
  taskExecStatuses: {},

  loadTasks: async (projectId) => {
    const [tasks, taskExecStatuses] = await Promise.all([
      repo.listTasks(projectId),
      repo.getLatestExecutionStatusPerTask(projectId),
    ]);
    // Discard stale responses if user switched projects while fetching
    if (useProjectStore.getState().activeProject?.id !== projectId) return;
    const current = get().activeTask;
    set({
      tasks,
      taskExecStatuses,
      activeTask: current
        ? tasks.find((t) => t.id === current.id) ?? null
        : null,
    });
  },

  loadStageTemplates: async (projectId) => {
    const stageTemplates = await repo.listStageTemplates(projectId);
    // Discard stale responses if user switched projects while fetching
    if (useProjectStore.getState().activeProject?.id !== projectId) return;
    set({ stageTemplates });
  },

  loadExecutions: async (projectId, taskId) => {
    const executions = await repo.listStageExecutions(projectId, taskId);

    // Check the backend for actually running processes (only if needed)
    const hasRunning = executions.some((e) => e.status === "running");
    let detailedProcesses: ProcessInfo[] | null = null;
    if (hasRunning) {
      try {
        detailedProcesses = await listProcessesDetailed();
      } catch (err) {
        logger.error("Failed to clean up stale executions", err);
      }
    }

    // Clean up stale "running" executions whose process is no longer alive
    if (detailedProcesses !== null) {
      const runningExecIds = new Set(
        detailedProcesses.map((p) => p.stageExecutionId).filter(Boolean),
      );

      // For research executions (task_stage_id is null), use the research template ID
      // to match the synthetic TaskStageInstance created by getActiveTaskStageInstances().
      const researchTemplateId = get().stageTemplates.find((t) => t.sort_order === 0)?.id;
      const resolveStageId = (exec: StageExecution) =>
        exec.task_stage_id ?? researchTemplateId ?? exec.task_id;

      for (const exec of executions) {
        if (exec.status === "running") {
          const sk = stageKey(exec.task_id, resolveStageId(exec));
          const stageState = useProcessStore.getState().stages[sk];
          // Skip if processStore thinks this is actively running (current session spawn)
          if (stageState?.isRunning) continue;

          // If this execution's ID is NOT in the backend's running processes, it's orphaned
          if (!runningExecIds.has(exec.id)) {
            try {
              await repo.updateStageExecution(projectId, exec.id, {
                status: "failed",
                error_message: "Process crashed or was interrupted",
                completed_at: new Date().toISOString(),
              });
              exec.status = "failed";
              exec.error_message = "Process crashed or was interrupted";
              useProcessStore.getState().setStopped(sk);
            } catch (err) {
              logger.error("Failed to clean up stale execution:", exec.id, err);
            }
          }
        }
      }
    }

    const taskExecStatuses = await repo.getLatestExecutionStatusPerTask(projectId);

    // Discard stale responses: if the user switched tasks while this fetch was
    // in flight, the active task has changed and this data should not overwrite
    // the executions that were (or will be) loaded for the current task.
    if (get().activeTask?.id !== taskId) return;

    set({ executions, taskExecStatuses });
  },

  loadTaskStages: async (projectId, taskId) => {
    const instances = await repo.getTaskStageInstances(projectId, taskId);
    if (useProjectStore.getState().activeProject?.id !== projectId) return;
    set((state) => ({
      taskStages: { ...state.taskStages, [taskId]: instances },
    }));
  },

  setTaskStages: async (projectId, taskId, stages) => {
    await repo.setTaskStages(projectId, taskId, stages);
    const [instances, tasks] = await Promise.all([
      repo.getTaskStageInstances(projectId, taskId),
      repo.listTasks(projectId),
    ]);
    if (useProjectStore.getState().activeProject?.id !== projectId) return;
    const active = get().activeTask;
    set((state) => ({
      tasks,
      activeTask:
        active?.id === taskId
          ? tasks.find((t) => t.id === taskId) ?? null
          : active,
      taskStages: { ...state.taskStages, [taskId]: instances },
    }));
  },

  insertTaskStage: async (projectId, taskId, templateId, sortOrder, agent, model) => {
    await repo.insertTaskStage(projectId, taskId, templateId, sortOrder, agent, model);
    const instances = await repo.getTaskStageInstances(projectId, taskId);
    if (useProjectStore.getState().activeProject?.id !== projectId) return;
    set((state) => ({
      taskStages: { ...state.taskStages, [taskId]: instances },
    }));
  },

  renumberTaskStages: async (projectId, taskId) => {
    await repo.renumberTaskStages(projectId, taskId);
    const instances = await repo.getTaskStageInstances(projectId, taskId);
    if (useProjectStore.getState().activeProject?.id !== projectId) return;
    set((state) => ({
      taskStages: { ...state.taskStages, [taskId]: instances },
    }));
  },

  getActiveTaskStageInstances: () => {
    const { activeTask, stageTemplates, taskStages } = get();
    if (!activeTask) return [];
    const instances = taskStages[activeTask.id];
    if (!instances || instances.length === 0) {
      // Before stage selection (or before loadTaskStages has populated the
      // cache): return the research stage as a synthetic instance.  Use the
      // task's current_stage_id when available so that isCurrentStage
      // (task.current_stage_id === stage.task_stage_id) matches immediately,
      // avoiding a flash of "Waiting for earlier stages to complete".
      const research = stageTemplates.find((t) => t.sort_order === 0);
      if (research) {
        const syntheticId = activeTask.current_stage_id ?? research.id;
        return [{
          ...research,
          task_stage_id: syntheticId,
          stage_template_id: research.id,
          agent_override: null,
          model_override: null,
          suggested_next_template_id: null,
          suggestion_reason: null,
        }];
      }
      return [];
    }
    return instances;
  },

  setActiveTask: (task) => {
    const prev = get().activeTask;
    if (prev?.id !== task?.id) {
      // Clear ALL stale commit-related state from processStore so it doesn't
      // bleed across tasks. Stage template IDs are shared across tasks, so
      // bare stage.id comparisons (used by committedStages, pendingCommit,
      // noChangesStageId, commitMessageLoadingStageId) would match the wrong
      // task's state — causing the "Preparing commit..." spinner to get stuck.
      const ps = useProcessStore.getState();
      ps.setCommitMessageLoading(null);
      ps.clearPendingCommit();
      ps.setNoChangesToCommit(null);
      // committedStages is keyed by bare stage.id; stale entries from the
      // previous task prevent both commit generation and the timeout fallback,
      // leaving the UI permanently stuck on "Preparing commit...".
      useProcessStore.setState({ committedStages: {}, mergeStages: {} });
    }
    set({ activeTask: task, executions: [] });
  },

  consumeInitialInput: (taskId) => {
    return consumeInitialInputFromStorage(taskId);
  },

  addTask: async (projectId, title, initialInput, branchName) => {
    // Find the first stage template (sort_order 0) so we can create a real
    // task_stage row and set current_stage_id at creation time.
    const templates = get().stageTemplates;
    const firstTemplate = templates.find((t) => t.sort_order === 0);

    const task = await repo.createTask(
      projectId,
      title,
      null,
      branchName,
    );

    // Create the initial task_stage and point current_stage_id at it
    if (firstTemplate) {
      const taskStageId = await repo.insertTaskStage(
        projectId, task.id, firstTemplate.id, firstTemplate.sort_order,
      );
      await repo.updateTask(projectId, task.id, { current_stage_id: taskStageId });
      task.current_stage_id = taskStageId;
    }

    // Eagerly load task stages into the store so the UI doesn't flash
    // "Waiting for earlier stages" before PipelineView's effect fires.
    const instances = await repo.getTaskStageInstances(projectId, task.id);

    const tasks = await repo.listTasks(projectId);
    if (initialInput) setInitialInput(task.id, initialInput);
    // Only update store if this project is still active
    if (useProjectStore.getState().activeProject?.id !== projectId) return task;
    set((state) => ({
      tasks,
      activeTask: task,
      taskStages: { ...state.taskStages, [task.id]: instances },
    }));
    return task;
  },

  updateTask: async (projectId, taskId, updates) => {
    await repo.updateTask(projectId, taskId, updates);
    // Only refresh the store task list if this project is still active;
    // background stage completions for other projects must not overwrite
    // the currently displayed task list.
    if (useProjectStore.getState().activeProject?.id !== projectId) return;
    const tasks = await repo.listTasks(projectId);
    if (useProjectStore.getState().activeProject?.id !== projectId) return;
    const active = get().activeTask;
    set({
      tasks,
      activeTask:
        active?.id === taskId
          ? tasks.find((t) => t.id === taskId) ?? null
          : active,
    });
  },

  refreshExecution: async (projectId, _executionId) => {
    const task = get().activeTask;
    if (task) {
      const [executions, taskExecStatuses] = await Promise.all([
        repo.listStageExecutions(projectId, task.id),
        repo.getLatestExecutionStatusPerTask(projectId),
      ]);
      if (useProjectStore.getState().activeProject?.id !== projectId) return;
      set({ executions, taskExecStatuses });
    }
  },

  refreshTaskExecStatuses: async (projectId) => {
    const taskExecStatuses = await repo.getLatestExecutionStatusPerTask(projectId);
    if (useProjectStore.getState().activeProject?.id !== projectId) return;
    set({ taskExecStatuses });
  },

  createStageTemplate: async (projectId, template) => {
    const created = await repo.createStageTemplate(projectId, template);
    const stageTemplates = await repo.listStageTemplates(projectId);
    if (useProjectStore.getState().activeProject?.id !== projectId) return created;
    set({ stageTemplates });
    return created;
  },

  deleteStageTemplate: async (projectId, templateId) => {
    await repo.deleteStageTemplate(projectId, templateId);
    const stageTemplates = await repo.listStageTemplates(projectId);
    if (useProjectStore.getState().activeProject?.id !== projectId) return;
    set({ stageTemplates });
  },

  reorderStageTemplates: async (projectId, orderedIds) => {
    await repo.reorderStageTemplates(projectId, orderedIds);
    const stageTemplates = await repo.listStageTemplates(projectId);
    if (useProjectStore.getState().activeProject?.id !== projectId) return;
    set({ stageTemplates });
  },

  duplicateStageTemplate: async (projectId, templateId) => {
    const created = await repo.duplicateStageTemplate(projectId, templateId);
    const stageTemplates = await repo.listStageTemplates(projectId);
    if (useProjectStore.getState().activeProject?.id !== projectId) return created;
    set({ stageTemplates });
    return created;
  },

  createSubtasks: async (projectId, parentTaskId, subtasks) => {
    const created: Task[] = [];
    const templates = get().stageTemplates;
    const firstTemplate = templates.find((t) => t.sort_order === 0);
    for (const sub of subtasks) {
      const task = await repo.createTask(
        projectId,
        sub.title,
        null,
        undefined,
        undefined,
        parentTaskId,
      );
      if (firstTemplate) {
        const taskStageId = await repo.insertTaskStage(
          projectId, task.id, firstTemplate.id, firstTemplate.sort_order,
        );
        await repo.updateTask(projectId, task.id, { current_stage_id: taskStageId });
        task.current_stage_id = taskStageId;
      }
      if (sub.initialInput) setInitialInput(task.id, sub.initialInput);
      created.push(task);

      // Eagerly populate taskStages so the UI is ready if this subtask is selected
      const instances = await repo.getTaskStageInstances(projectId, task.id);
      set((state) => ({
        taskStages: { ...state.taskStages, [task.id]: instances },
      }));
    }

    // Refresh the task list so new subtasks appear in sidebar
    await get().loadTasks(projectId);
    return created;
  },
}));
