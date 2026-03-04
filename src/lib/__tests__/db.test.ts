import { getAppDb, getProjectDb } from "../db";
import { getMockDatabase } from "../../test/mocks/database";
import { mockInvoke } from "../../test/mocks/tauri";

beforeEach(() => {
  mockInvoke("get_stagehand_dir", () => "/mock/stagehand");
});

describe("getAppDb", () => {
  it("creates the app database and initializes schema", async () => {
    const db = await getAppDb();
    expect(db).toBeDefined();
    // Schema initialization should have created tables
    const mockDb = getMockDatabase("sqlite:/mock/stagehand/app.db");
    const executeCalls = mockDb.execute.mock.calls.map((c: unknown[]) => c[0] as string);
    // Should have CREATE TABLE for projects and settings
    expect(executeCalls.some((sql: string) => sql.includes("CREATE TABLE IF NOT EXISTS projects"))).toBe(true);
    expect(executeCalls.some((sql: string) => sql.includes("CREATE TABLE IF NOT EXISTS settings"))).toBe(true);
  });

  it("returns same instance on subsequent calls", async () => {
    const db1 = await getAppDb();
    const db2 = await getAppDb();
    expect(db1).toBe(db2);
  });
});

describe("getProjectDb", () => {
  it("creates project database and initializes schema", async () => {
    const db = await getProjectDb("proj-1");
    expect(db).toBeDefined();
    const mockDb = getMockDatabase("sqlite:/mock/stagehand/data/proj-1.db");
    const executeCalls = mockDb.execute.mock.calls.map((c: unknown[]) => c[0] as string);
    // Should have CREATE TABLE for core tables
    expect(executeCalls.some((sql: string) => sql.includes("CREATE TABLE IF NOT EXISTS stage_templates"))).toBe(true);
    expect(executeCalls.some((sql: string) => sql.includes("CREATE TABLE IF NOT EXISTS tasks"))).toBe(true);
    expect(executeCalls.some((sql: string) => sql.includes("CREATE TABLE IF NOT EXISTS stage_executions"))).toBe(true);
    expect(executeCalls.some((sql: string) => sql.includes("CREATE TABLE IF NOT EXISTS task_stages"))).toBe(true);
    expect(executeCalls.some((sql: string) => sql.includes("CREATE TABLE IF NOT EXISTS pr_review_fixes"))).toBe(true);
  });

  it("returns same instance for same project id", async () => {
    const db1 = await getProjectDb("proj-2");
    const db2 = await getProjectDb("proj-2");
    expect(db1).toBe(db2);
  });

  it("returns different instances for different project ids", async () => {
    const db1 = await getProjectDb("proj-3");
    const db2 = await getProjectDb("proj-4");
    expect(db1).not.toBe(db2);
  });

  it("runs ALTER TABLE migrations", async () => {
    await getProjectDb("proj-5");
    const mockDb = getMockDatabase("sqlite:/mock/stagehand/data/proj-5.db");
    const executeCalls = mockDb.execute.mock.calls.map((c: unknown[]) => c[0] as string);
    // Should attempt ALTER TABLE migrations (they catch errors if column exists)
    expect(executeCalls.some((sql: string) => sql.includes("ALTER TABLE") && sql.includes("thinking_output"))).toBe(true);
    expect(executeCalls.some((sql: string) => sql.includes("ALTER TABLE") && sql.includes("stage_result"))).toBe(true);
    expect(executeCalls.some((sql: string) => sql.includes("ALTER TABLE") && sql.includes("stage_summary"))).toBe(true);
    expect(executeCalls.some((sql: string) => sql.includes("ALTER TABLE") && sql.includes("branch_name"))).toBe(true);
    expect(executeCalls.some((sql: string) => sql.includes("ALTER TABLE") && sql.includes("pr_url"))).toBe(true);
  });
});
