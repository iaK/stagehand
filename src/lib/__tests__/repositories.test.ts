import { vi } from "vitest";
import {
  getSetting,
  setSetting,
  deleteSetting,
  getProjectSetting,
  setProjectSetting,
  deleteProjectSetting,
  listProjects,
  listArchivedProjects,
  createProject,
  deleteProject,
  updateProject,
  listStageTemplates,
  updateStageTemplate,
  listTasks,
  createTask,
  updateTask,
  getLatestExecutionStatusPerTask,
  listStageExecutions,
  getLatestExecution,
  createStageExecution,
  updateStageExecution,
  getExecutionsForStage,
  getPreviousStageExecution,
  getTaskStageInstances,
  setTaskStages,
  getApprovedStageSummaries,
  getProjectTaskSummary,
} from "../repositories";
import { makeStageTemplate, makeStageExecution } from "../../test/fixtures";
import type { TaskStageInstance } from "../types";

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

// Create stable mock db instances that persist across the module
const appDbMock = {
  execute: vi.fn().mockResolvedValue(undefined),
  select: vi.fn().mockResolvedValue([]),
  close: vi.fn().mockResolvedValue(undefined),
};

const projectDbMocks: Record<string, ReturnType<typeof createProjectDbMock>> = {};

function createProjectDbMock() {
  return {
    execute: vi.fn().mockResolvedValue(undefined),
    select: vi.fn().mockResolvedValue([]),
    close: vi.fn().mockResolvedValue(undefined),
  };
}

function getProjectMock(projectId: string) {
  if (!projectDbMocks[projectId]) {
    projectDbMocks[projectId] = createProjectDbMock();
  }
  return projectDbMocks[projectId];
}

// Mock the db module to return our controlled mock instances
vi.mock("../db", () => ({
  getAppDb: vi.fn(async () => appDbMock),
  getProjectDb: vi.fn(async (projectId: string) => getProjectMock(projectId)),
}));

beforeEach(() => {
  appDbMock.execute.mockClear().mockResolvedValue(undefined);
  appDbMock.select.mockClear().mockResolvedValue([]);
  for (const key of Object.keys(projectDbMocks)) {
    projectDbMocks[key].execute.mockClear().mockResolvedValue(undefined);
    projectDbMocks[key].select.mockClear().mockResolvedValue([]);
  }
});

// ─── Settings ────────────────────────────────────────────────────────────────

describe("getSetting", () => {
  it("returns value when setting exists", async () => {
    appDbMock.select.mockResolvedValueOnce([{ value: "dark" }]);
    const result = await getSetting("theme");
    expect(result).toBe("dark");
    expect(appDbMock.select).toHaveBeenCalledWith(
      "SELECT value FROM settings WHERE key = $1",
      ["theme"],
    );
  });

  it("returns null when setting does not exist", async () => {
    appDbMock.select.mockResolvedValueOnce([]);
    const result = await getSetting("missing");
    expect(result).toBeNull();
  });
});

describe("setSetting", () => {
  it("executes upsert query", async () => {
    await setSetting("theme", "dark");
    expect(appDbMock.execute).toHaveBeenCalledWith(
      "INSERT INTO settings (key, value) VALUES ($1, $2) ON CONFLICT(key) DO UPDATE SET value = $2",
      ["theme", "dark"],
    );
  });
});

describe("deleteSetting", () => {
  it("executes delete query", async () => {
    await deleteSetting("theme");
    expect(appDbMock.execute).toHaveBeenCalledWith(
      "DELETE FROM settings WHERE key = $1",
      ["theme"],
    );
  });
});

// ─── Per-Project Settings ────────────────────────────────────────────────────

describe("getProjectSetting", () => {
  it("returns value from project db", async () => {
    getProjectMock("p1").select.mockResolvedValueOnce([{ value: "val" }]);
    const result = await getProjectSetting("p1", "key");
    expect(result).toBe("val");
  });

  it("returns null when not found", async () => {
    getProjectMock("p1").select.mockResolvedValueOnce([]);
    const result = await getProjectSetting("p1", "key");
    expect(result).toBeNull();
  });
});

describe("setProjectSetting", () => {
  it("executes upsert on project db", async () => {
    await setProjectSetting("p1", "key", "val");
    expect(getProjectMock("p1").execute).toHaveBeenCalledWith(
      "INSERT INTO settings (key, value) VALUES ($1, $2) ON CONFLICT(key) DO UPDATE SET value = $2",
      ["key", "val"],
    );
  });
});

describe("deleteProjectSetting", () => {
  it("executes delete on project db", async () => {
    await deleteProjectSetting("p1", "key");
    expect(getProjectMock("p1").execute).toHaveBeenCalledWith(
      "DELETE FROM settings WHERE key = $1",
      ["key"],
    );
  });
});

// ─── Projects ────────────────────────────────────────────────────────────────

describe("listProjects", () => {
  it("queries active projects ordered by updated_at", async () => {
    const projects = [{ id: "1", name: "A" }];
    appDbMock.select.mockResolvedValueOnce(projects);
    const result = await listProjects();
    expect(result).toEqual(projects);
    expect(appDbMock.select).toHaveBeenCalledWith(
      "SELECT * FROM projects WHERE archived = 0 ORDER BY updated_at DESC",
    );
  });
});

describe("listArchivedProjects", () => {
  it("queries archived projects", async () => {
    appDbMock.select.mockResolvedValueOnce([]);
    const result = await listArchivedProjects();
    expect(result).toEqual([]);
    expect(appDbMock.select).toHaveBeenCalledWith(
      "SELECT * FROM projects WHERE archived = 1 ORDER BY updated_at DESC",
    );
  });
});

describe("createProject", () => {
  it("inserts project and seeds templates", async () => {
    const result = await createProject("My Project", "/path");
    expect(result.name).toBe("My Project");
    expect(result.path).toBe("/path");
    expect(result.archived).toBe(0);
    expect(result.id).toBeDefined();
    // Should have called execute on the app db for insert
    expect(appDbMock.execute).toHaveBeenCalled();
    // Should have called execute on the project db for template seeding
    expect(getProjectMock(result.id).execute).toHaveBeenCalled();
  });
});

describe("deleteProject", () => {
  it("executes delete query", async () => {
    await deleteProject("proj-1");
    expect(appDbMock.execute).toHaveBeenCalledWith(
      "DELETE FROM projects WHERE id = $1",
      ["proj-1"],
    );
  });
});

describe("updateProject", () => {
  it("builds dynamic SET clause for name update", async () => {
    await updateProject("proj-1", { name: "New Name" });
    const call = appDbMock.execute.mock.calls.find(
      (c: unknown[]) => typeof c[0] === "string" && (c[0] as string).includes("UPDATE projects"),
    );
    expect(call).toBeDefined();
    expect(call![0]).toContain("name = $1");
    expect(call![1]).toContain("New Name");
    expect(call![1]).toContain("proj-1");
  });

  it("builds dynamic SET clause for archive update", async () => {
    await updateProject("proj-1", { archived: 1 });
    const call = appDbMock.execute.mock.calls.find(
      (c: unknown[]) => typeof c[0] === "string" && (c[0] as string).includes("UPDATE projects"),
    );
    expect(call).toBeDefined();
    expect(call![0]).toContain("archived = $1");
    expect(call![1]).toContain(1);
  });
});

// ─── Stage Templates ─────────────────────────────────────────────────────────

describe("listStageTemplates", () => {
  it("queries templates for project ordered by sort_order", async () => {
    const templates = [makeStageTemplate()];
    getProjectMock("p1").select.mockResolvedValueOnce(templates);
    const result = await listStageTemplates("p1");
    expect(result).toEqual(templates);
  });
});

describe("updateStageTemplate", () => {
  it("builds dynamic SET clause", async () => {
    await updateStageTemplate("p1", "tmpl-1", { name: "Renamed" });
    const call = getProjectMock("p1").execute.mock.calls.find(
      (c: unknown[]) => typeof c[0] === "string" && (c[0] as string).includes("UPDATE stage_templates"),
    );
    expect(call).toBeDefined();
    expect(call![0]).toContain("name = $1");
  });
});

// ─── Tasks ───────────────────────────────────────────────────────────────────

describe("listTasks", () => {
  it("queries non-archived tasks for project", async () => {
    getProjectMock("p1").select.mockResolvedValueOnce([]);
    const result = await listTasks("p1");
    expect(result).toEqual([]);
  });
});

describe("createTask", () => {
  it("inserts task and returns it", async () => {
    const result = await createTask("p1", "Fix bug", "stage-1", "feature/fix");
    expect(result.title).toBe("Fix bug");
    expect(result.project_id).toBe("p1");
    expect(result.status).toBe("pending");
    expect(result.branch_name).toBe("feature/fix");
  });

  it("uses null for branch_name when not provided", async () => {
    const result = await createTask("p1", "Fix bug", "stage-1");
    expect(result.branch_name).toBeNull();
  });
});

describe("updateTask", () => {
  it("builds dynamic SET clause for status update", async () => {
    await updateTask("p1", "task-1", { status: "completed" });
    const call = getProjectMock("p1").execute.mock.calls.find(
      (c: unknown[]) => typeof c[0] === "string" && (c[0] as string).includes("UPDATE tasks"),
    );
    expect(call).toBeDefined();
    expect(call![0]).toContain("status = $1");
  });
});

// ─── Stage Executions ────────────────────────────────────────────────────────

describe("getLatestExecutionStatusPerTask", () => {
  it("returns map of task_id to status", async () => {
    getProjectMock("p1").select.mockResolvedValueOnce([
      { task_id: "t1", status: "approved" },
      { task_id: "t2", status: "running" },
    ]);
    const result = await getLatestExecutionStatusPerTask("p1");
    expect(result).toEqual({ t1: "approved", t2: "running" });
  });
});

describe("listStageExecutions", () => {
  it("queries executions for task", async () => {
    const execs = [makeStageExecution()];
    getProjectMock("p1").select.mockResolvedValueOnce(execs);
    const result = await listStageExecutions("p1", "t1");
    expect(result).toEqual(execs);
  });
});

describe("getLatestExecution", () => {
  it("returns latest execution when found", async () => {
    const exec = makeStageExecution();
    getProjectMock("p1").select.mockResolvedValueOnce([exec]);
    const result = await getLatestExecution("p1", "t1", "s1");
    expect(result).toEqual(exec);
  });

  it("returns null when no executions found", async () => {
    getProjectMock("p1").select.mockResolvedValueOnce([]);
    const result = await getLatestExecution("p1", "t1", "s1");
    expect(result).toBeNull();
  });
});

describe("createStageExecution", () => {
  it("inserts and returns execution with null completed_at", async () => {
    const exec = makeStageExecution({ completed_at: null });
    const { completed_at: _, ...execWithoutCompleted } = exec;
    const result = await createStageExecution("p1", execWithoutCompleted);
    expect(result.completed_at).toBeNull();
    expect(result.id).toBe(exec.id);
  });
});

describe("updateStageExecution", () => {
  it("builds dynamic SET clause", async () => {
    await updateStageExecution("p1", "exec-1", { status: "approved" });
    const call = getProjectMock("p1").execute.mock.calls.find(
      (c: unknown[]) => typeof c[0] === "string" && (c[0] as string).includes("UPDATE stage_executions"),
    );
    expect(call).toBeDefined();
    expect(call![0]).toContain("status = $1");
  });
});

describe("getExecutionsForStage", () => {
  it("queries by task_id and task_stage_id", async () => {
    getProjectMock("p1").select.mockResolvedValueOnce([]);
    await getExecutionsForStage("p1", "t1", "ts1");
    expect(getProjectMock("p1").select).toHaveBeenCalledWith(
      "SELECT * FROM stage_executions WHERE task_id = $1 AND task_stage_id = $2 ORDER BY attempt_number ASC",
      ["t1", "ts1"],
    );
  });
});

describe("getPreviousStageExecution", () => {
  it("returns null for sort_order 0", async () => {
    const result = await getPreviousStageExecution("p1", "t1", 0, []);
    expect(result).toBeNull();
  });

  it("returns null when no previous instance exists", async () => {
    const instances = [makeTaskStageInstance({ sort_order: 2, task_stage_id: "ts-2" })];
    const result = await getPreviousStageExecution("p1", "t1", 2, instances);
    expect(result).toBeNull();
  });

  it("returns approved execution from previous instance", async () => {
    const instances = [
      makeTaskStageInstance({ id: "s1", sort_order: 0, task_stage_id: "ts-s1" }),
      makeTaskStageInstance({ id: "s2", sort_order: 1, task_stage_id: "ts-s2" }),
    ];
    const exec = makeStageExecution({ task_stage_id: "ts-s1", status: "approved" });
    getProjectMock("p1").select.mockResolvedValueOnce([exec]);
    const result = await getPreviousStageExecution("p1", "t1", 1, instances);
    expect(result).toEqual(exec);
  });
});

// ─── Task Stages ─────────────────────────────────────────────────────────────

describe("getTaskStageInstances", () => {
  it("returns ordered task stage instances", async () => {
    getProjectMock("p1").select.mockResolvedValueOnce([
      { task_stage_id: "ts1", stage_template_id: "s1", sort_order: 1000, id: "s1", name: "Research" },
      { task_stage_id: "ts2", stage_template_id: "s3", sort_order: 2000, id: "s3", name: "Planning" },
    ]);
    const result = await getTaskStageInstances("p1", "t1");
    expect(result).toHaveLength(2);
    expect(result[0].task_stage_id).toBe("ts1");
    expect(result[1].task_stage_id).toBe("ts2");
  });
});

describe("setTaskStages", () => {
  it("preserves reusable stage ids and repairs current_stage_id", async () => {
    const db = getProjectMock("p1");
    db.select
      .mockResolvedValueOnce([
        { id: "ts-research", stage_template_id: "s1", sort_order: 0 },
        { id: "ts-planning", stage_template_id: "s2", sort_order: 1000 },
      ])
      .mockResolvedValueOnce([{ current_stage_id: "ts-planning" }]);

    await setTaskStages("p1", "t1", [
      { stageTemplateId: "s1", sortOrder: 0 },
      { stageTemplateId: "s3", sortOrder: 1000 },
    ]);

    expect(db.execute).toHaveBeenCalledWith(
      expect.stringContaining("UPDATE stage_executions"),
      ["t1", "ts-planning"],
    );

    expect(db.execute).toHaveBeenCalledWith(
      expect.stringContaining("DELETE FROM task_stages"),
      ["t1", "ts-planning"],
    );

    expect(db.execute).toHaveBeenCalledWith(
      expect.stringContaining("UPDATE task_stages"),
      ["s1", 0, "ts-research"],
    );

    const insertCalls = db.execute.mock.calls.filter((c: unknown[]) =>
      typeof c[0] === "string" && (c[0] as string).includes("INSERT INTO task_stages"),
    );
    expect(insertCalls).toHaveLength(1);

    expect(db.execute).toHaveBeenCalledWith(
      "UPDATE tasks SET current_stage_id = $1, updated_at = $2 WHERE id = $3",
      ["ts-research", expect.any(String), "t1"],
    );
  });
});

// ─── Approved Stage Summaries ────────────────────────────────────────────────

describe("getApprovedStageSummaries", () => {
  it("returns summaries for approved executions", async () => {
    const rows = [
      { stage_name: "Research", stage_summary: "Found the bug" },
      { stage_name: "Planning", stage_summary: "Fix approach" },
    ];
    getProjectMock("p1").select.mockResolvedValueOnce(rows);
    const result = await getApprovedStageSummaries("p1", "t1");
    expect(result).toEqual(rows);
  });
});

// ─── Project Task Summary ─────────────────────────────────────────────────

describe("getProjectTaskSummary", () => {
  it("returns task statuses and execution statuses", async () => {
    const db = getProjectMock("p1");
    db.select
      .mockResolvedValueOnce([{ status: "pending" }, { status: "completed" }])
      .mockResolvedValueOnce([{ status: "running" }]);

    const result = await getProjectTaskSummary("p1");
    expect(result.taskStatuses).toEqual(["pending", "completed"]);
    expect(result.execStatuses).toEqual(["running"]);
  });

  it("returns empty arrays when no tasks exist", async () => {
    const db = getProjectMock("p1");
    db.select
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);

    const result = await getProjectTaskSummary("p1");
    expect(result.taskStatuses).toEqual([]);
    expect(result.execStatuses).toEqual([]);
  });
});
