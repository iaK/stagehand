import { vi } from "vitest";
import { useTaskStore } from "../taskStore";
import { makeTask, makeStageTemplate } from "../../test/fixtures";
import type { TaskStageInstance } from "../../lib/types";

function makeTaskStageInstance(overrides?: Partial<TaskStageInstance>): TaskStageInstance {
  const template = makeStageTemplate(overrides);
  return {
    ...template,
    task_stage_id: overrides?.task_stage_id ?? `ts-${template.id}`,
    stage_template_id: template.id,
    agent_override: overrides?.agent_override ?? null,
    model_override: overrides?.model_override ?? null,
    suggested_next_template_id: overrides?.suggested_next_template_id ?? null,
    suggestion_reason: overrides?.suggestion_reason ?? null,
  };
}

// Mock the repositories module
vi.mock("../../lib/repositories", () => ({
  listTasks: vi.fn(),
  createTask: vi.fn(),
  updateTask: vi.fn(),
  listStageTemplates: vi.fn(),
  listStageExecutions: vi.fn(),
  getLatestExecutionStatusPerTask: vi.fn().mockResolvedValue({}),
  getTaskStageInstances: vi.fn(),
  setTaskStages: vi.fn(),
  updateStageExecution: vi.fn(),
}));

// Mock claude
vi.mock("../../lib/claude", () => ({
  listProcessesDetailed: vi.fn().mockResolvedValue([]),
}));

// Mock processStore to avoid cross-store issues
vi.mock("../processStore", () => ({
  useProcessStore: {
    getState: () => ({
      stages: {},
      setStopped: vi.fn(),
    }),
  },
}));

// eslint-disable-next-line @typescript-eslint/consistent-type-imports
const repo = await vi.importMock<typeof import("../../lib/repositories")>("../../lib/repositories");

describe("taskStore", () => {
  beforeEach(() => {
    useTaskStore.setState({
      tasks: [],
      activeTask: null,
      stageTemplates: [],
      executions: [],
      loading: false,
      taskStages: {},
      taskExecStatuses: {},
    });
  });

  describe("loadTasks", () => {
    it("calls listTasks and sets state", async () => {
      const tasks = [makeTask({ title: "Task A" }), makeTask({ title: "Task B" })];
      vi.mocked(repo.listTasks).mockResolvedValue(tasks);
      vi.mocked(repo.getLatestExecutionStatusPerTask).mockResolvedValue({});

      await useTaskStore.getState().loadTasks("project-1");

      expect(repo.listTasks).toHaveBeenCalledWith("project-1");
      expect(useTaskStore.getState().tasks).toEqual(tasks);
    });

    it("preserves active task if still in list", async () => {
      const task = makeTask({ title: "Active" });
      useTaskStore.setState({ activeTask: task });

      vi.mocked(repo.listTasks).mockResolvedValue([task]);
      vi.mocked(repo.getLatestExecutionStatusPerTask).mockResolvedValue({});

      await useTaskStore.getState().loadTasks("project-1");

      expect(useTaskStore.getState().activeTask).toEqual(task);
    });

    it("clears active task if it was removed", async () => {
      const oldTask = makeTask({ title: "Old" });
      useTaskStore.setState({ activeTask: oldTask });

      vi.mocked(repo.listTasks).mockResolvedValue([]);
      vi.mocked(repo.getLatestExecutionStatusPerTask).mockResolvedValue({});

      await useTaskStore.getState().loadTasks("project-1");

      expect(useTaskStore.getState().activeTask).toBeNull();
    });
  });

  describe("addTask", () => {
    it("calls createTask and updates state", async () => {
      const template = makeStageTemplate({ id: "stage-1" });
      useTaskStore.setState({ stageTemplates: [template] });

      const newTask = makeTask({ title: "New Task" });
      vi.mocked(repo.createTask).mockResolvedValue(newTask);
      vi.mocked(repo.listTasks).mockResolvedValue([newTask]);

      const result = await useTaskStore.getState().addTask("project-1", "New Task");

      expect(repo.createTask).toHaveBeenCalledWith(
        "project-1",
        "New Task",
        "stage-1",
        undefined,
      );
      expect(result).toEqual(newTask);
      expect(useTaskStore.getState().activeTask).toEqual(newTask);
    });
  });

  describe("setActiveTask", () => {
    it("updates active task state", () => {
      const task = makeTask({ title: "Selected" });
      useTaskStore.getState().setActiveTask(task);
      expect(useTaskStore.getState().activeTask).toEqual(task);
    });

    it("can set active task to null", () => {
      useTaskStore.setState({ activeTask: makeTask() });
      useTaskStore.getState().setActiveTask(null);
      expect(useTaskStore.getState().activeTask).toBeNull();
    });
  });

  describe("getActiveTaskStageInstances", () => {
    it("returns synthetic research instance when no task stages configured", () => {
      const templates = [
        makeStageTemplate({ id: "s1", sort_order: 0 }),
        makeStageTemplate({ id: "s2", sort_order: 1 }),
      ];
      const task = makeTask({ id: "t1" });
      useTaskStore.setState({ stageTemplates: templates, activeTask: task, taskStages: {} });

      const result = useTaskStore.getState().getActiveTaskStageInstances();
      expect(result).toHaveLength(1);
      expect(result[0].task_stage_id).toBe("s1");
    });

    it("returns instances when task stages are configured", () => {
      const templates = [
        makeStageTemplate({ id: "s1", sort_order: 0, name: "Research" }),
        makeStageTemplate({ id: "s2", sort_order: 1, name: "Planning" }),
        makeStageTemplate({ id: "s3", sort_order: 2, name: "Implementation" }),
      ];
      const instances: TaskStageInstance[] = [
        makeTaskStageInstance({ id: "s1", sort_order: 1000, name: "Research", task_stage_id: "ts-s1" }),
        makeTaskStageInstance({ id: "s3", sort_order: 2000, name: "Implementation", task_stage_id: "ts-s3" }),
      ];
      const task = makeTask({ id: "t1" });
      useTaskStore.setState({
        stageTemplates: templates,
        activeTask: task,
        taskStages: { t1: instances },
      });

      const result = useTaskStore.getState().getActiveTaskStageInstances();
      expect(result).toHaveLength(2);
      expect(result.map((t: TaskStageInstance) => t.name)).toEqual(["Research", "Implementation"]);
    });
  });
});
