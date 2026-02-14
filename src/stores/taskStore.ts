import { create } from "zustand";
import type { Task, StageTemplate, StageExecution } from "../lib/types";
import * as repo from "../lib/repositories";
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

    // Clean up stale "running" executions (process died on quit/reload)
    const isRunning = useProcessStore.getState().isRunning;
    if (!isRunning) {
      for (const exec of executions) {
        if (exec.status === "running") {
          await repo.updateStageExecution(projectId, exec.id, {
            status: "failed",
            error_message: "Process interrupted (app was closed)",
            completed_at: new Date().toISOString(),
          });
          exec.status = "failed";
          exec.error_message = "Process interrupted (app was closed)";
        }
      }
    }

    set({ executions });
  },

  setActiveTask: (task) => set({ activeTask: task }),

  addTask: async (projectId, title) => {
    const templates = get().stageTemplates;
    const firstStage = templates.length > 0 ? templates[0].id : "";
    const task = await repo.createTask(
      projectId,
      title,
      firstStage,
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
