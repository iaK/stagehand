import { create } from "zustand";
import type { Task, StageTemplate, StageExecution } from "../lib/types";
import * as repo from "../lib/repositories";
import { listProcesses } from "../lib/claude";
import { useProcessStore } from "./processStore";

interface TaskStore {
  tasks: Task[];
  activeTask: Task | null;
  stageTemplates: StageTemplate[];
  executions: StageExecution[];
  loading: boolean;

  loadTasks: (projectId: string) => Promise<void>;
  loadStageTemplates: (projectId: string) => Promise<void>;
  loadExecutions: (projectId: string, taskId: string) => Promise<void>;
  setActiveTask: (task: Task | null) => void;
  addTask: (
    projectId: string,
    title: string,
    description?: string,
  ) => Promise<Task>;
  updateTask: (
    projectId: string,
    taskId: string,
    updates: Partial<Pick<Task, "current_stage_id" | "status" | "title" | "archived">>,
  ) => Promise<void>;
  refreshExecution: (
    projectId: string,
    executionId: string,
  ) => Promise<void>;
}

export const useTaskStore = create<TaskStore>((set, get) => ({
  tasks: [],
  activeTask: null,
  stageTemplates: [],
  executions: [],
  loading: false,

  loadTasks: async (projectId) => {
    const tasks = await repo.listTasks(projectId);
    const current = get().activeTask;
    set({
      tasks,
      activeTask: current
        ? tasks.find((t) => t.id === current.id) ?? null
        : null,
    });
  },

  loadStageTemplates: async (projectId) => {
    const stageTemplates = await repo.listStageTemplates(projectId);
    set({ stageTemplates });
  },

  loadExecutions: async (projectId, taskId) => {
    const executions = await repo.listStageExecutions(projectId, taskId);

    // Check the backend for actually running processes
    let runningProcessIds: string[] | null = null;
    try {
      runningProcessIds = await listProcesses();
    } catch {
      // If we can't reach the backend, don't assume anything about running state
    }

    // Clean up stale "running" executions whose process is no longer alive
    // Only do this when we could actually reach the backend
    if (runningProcessIds !== null && runningProcessIds.length === 0) {
      for (const exec of executions) {
        if (exec.status === "running") {
          await repo.updateStageExecution(projectId, exec.id, {
            status: "failed",
            error_message: "Process crashed or was interrupted",
            completed_at: new Date().toISOString(),
          });
          exec.status = "failed";
          exec.error_message = "Process crashed or was interrupted";
          // Also reset the process store so the Retry button isn't stuck disabled
          useProcessStore.getState().setStopped(exec.stage_template_id);
        }
      }
    }

    set({ executions });
  },

  setActiveTask: (task) => set({ activeTask: task }),

  addTask: async (projectId, title, description) => {
    const templates = get().stageTemplates;
    const firstStage = templates.length > 0 ? templates[0].id : "";
    const task = await repo.createTask(
      projectId,
      title,
      firstStage,
      description,
    );
    const tasks = await repo.listTasks(projectId);
    set({ tasks, activeTask: task });
    return task;
  },

  updateTask: async (projectId, taskId, updates) => {
    await repo.updateTask(projectId, taskId, updates);
    const tasks = await repo.listTasks(projectId);
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
      const executions = await repo.listStageExecutions(projectId, task.id);
      set({ executions });
    }
  },
}));
