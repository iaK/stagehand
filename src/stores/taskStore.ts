import { create } from "zustand";
import type { Task, StageTemplate, StageExecution } from "../lib/types";
import * as repo from "../lib/repositories";
import { listProcessesDetailed, type ProcessInfo } from "../lib/claude";
import { useProcessStore, stageKey } from "./processStore";

interface TaskStore {
  tasks: Task[];
  activeTask: Task | null;
  stageTemplates: StageTemplate[];
  executions: StageExecution[];
  loading: boolean;
  taskStages: Record<string, string[]>; // taskId → stageTemplateId[]
  taskExecStatuses: Record<string, string>; // taskId → latest execution status

  loadTasks: (projectId: string) => Promise<void>;
  loadStageTemplates: (projectId: string) => Promise<void>;
  loadExecutions: (projectId: string, taskId: string) => Promise<void>;
  loadTaskStages: (projectId: string, taskId: string) => Promise<void>;
  setTaskStages: (projectId: string, taskId: string, stages: { stageTemplateId: string; sortOrder: number }[]) => Promise<void>;
  getActiveTaskStageTemplates: () => StageTemplate[];
  setActiveTask: (task: Task | null) => void;
  addTask: (
    projectId: string,
    title: string,
    description?: string,
    branchName?: string,
  ) => Promise<Task>;
  updateTask: (
    projectId: string,
    taskId: string,
    updates: Partial<Pick<Task, "current_stage_id" | "status" | "title" | "archived" | "branch_name" | "worktree_path" | "pr_url">>,
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
  taskStages: {},
  taskExecStatuses: {},

  loadTasks: async (projectId) => {
    const [tasks, taskExecStatuses] = await Promise.all([
      repo.listTasks(projectId),
      repo.getLatestExecutionStatusPerTask(projectId),
    ]);
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
      } catch {
        // If we can't reach the backend, don't assume anything about running state
      }
    }

    // Clean up stale "running" executions whose process is no longer alive
    if (detailedProcesses !== null) {
      const runningExecIds = new Set(
        detailedProcesses.map((p) => p.stageExecutionId).filter(Boolean),
      );

      for (const exec of executions) {
        if (exec.status === "running") {
          const sk = stageKey(exec.task_id, exec.stage_template_id);
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
              console.error("Failed to clean up stale execution:", exec.id, err);
            }
          }
        }
      }
    }

    const taskExecStatuses = await repo.getLatestExecutionStatusPerTask(projectId);
    set({ executions, taskExecStatuses });
  },

  loadTaskStages: async (projectId, taskId) => {
    const stageIds = await repo.getTaskStages(projectId, taskId);
    set((state) => ({
      taskStages: { ...state.taskStages, [taskId]: stageIds },
    }));
  },

  setTaskStages: async (projectId, taskId, stages) => {
    await repo.setTaskStages(projectId, taskId, stages);
    const stageIds = stages.map((s) => s.stageTemplateId);
    set((state) => ({
      taskStages: { ...state.taskStages, [taskId]: stageIds },
    }));
  },

  getActiveTaskStageTemplates: () => {
    const { activeTask, stageTemplates, taskStages } = get();
    if (!activeTask) return stageTemplates;
    const selectedIds = taskStages[activeTask.id];
    if (!selectedIds || selectedIds.length === 0) return stageTemplates;
    const idSet = new Set(selectedIds);
    return stageTemplates.filter((t) => idSet.has(t.id));
  },

  setActiveTask: (task) => set({ activeTask: task }),

  addTask: async (projectId, title, description, branchName) => {
    const templates = get().stageTemplates;
    const firstStage = templates.length > 0 ? templates[0].id : "";
    const task = await repo.createTask(
      projectId,
      title,
      firstStage,
      description,
      branchName,
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
      const [executions, taskExecStatuses] = await Promise.all([
        repo.listStageExecutions(projectId, task.id),
        repo.getLatestExecutionStatusPerTask(projectId),
      ]);
      set({ executions, taskExecStatuses });
    }
  },
}));
