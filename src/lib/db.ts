import Database from "@tauri-apps/plugin-sql";
import { invoke } from "@tauri-apps/api/core";
import { initAppSchema, initProjectSchema } from "./db/schema";

let devflowDir: string | null = null;

async function getDevflowDir(): Promise<string> {
  if (!devflowDir) {
    devflowDir = await invoke<string>("get_devflow_dir");
  }
  return devflowDir;
}

/**
 * Wrapper around Database that serializes all execute/select calls through a
 * queue. SQLite (via the Tauri SQL plugin's sqlx pool) cannot handle concurrent
 * writes and will return "database is locked" (SQLITE_BUSY) when they overlap.
 * By funneling every operation through a promise chain we guarantee at most one
 * in-flight request per database file.
 */
class SerializedDatabase {
  private queue: Promise<unknown> = Promise.resolve();
  constructor(public readonly inner: Database) {}

  execute(sql: string, bindValues?: unknown[]) {
    const op: ReturnType<Database["execute"]> = this.queue.then(
      () => this.inner.execute(sql, bindValues),
      () => this.inner.execute(sql, bindValues),
    );
    this.queue = op.catch(() => {});
    return op;
  }

  select<T>(sql: string, bindValues?: unknown[]) {
    const op: Promise<T> = this.queue.then(
      () => this.inner.select<T>(sql, bindValues),
      () => this.inner.select<T>(sql, bindValues),
    );
    this.queue = op.catch(() => {});
    return op;
  }

  close(): Promise<boolean> {
    return this.inner.close();
  }
}

// Use the wrapper type everywhere so repositories.ts etc. see execute/select
export type AppDatabase = SerializedDatabase;

const connections: Record<string, SerializedDatabase> = {};
const connectionPromises: Record<string, Promise<SerializedDatabase>> = {};

export async function getAppDb(): Promise<SerializedDatabase> {
  if (connections["app"]) return connections["app"];
  if (!connectionPromises["app"]) {
    connectionPromises["app"] = (async () => {
      const dir = await getDevflowDir();
      const raw = await Database.load(`sqlite:${dir}/app.db`);
      const db = new SerializedDatabase(raw);
      await db.execute("PRAGMA journal_mode = WAL");
      await db.execute("PRAGMA busy_timeout = 5000");
      await initAppSchema(db as unknown as Database);
      connections["app"] = db;
      return db;
    })();
  }
  return connectionPromises["app"];
}

export async function getProjectDb(projectId: string): Promise<SerializedDatabase> {
  const key = `project:${projectId}`;
  if (connections[key]) return connections[key];
  if (!connectionPromises[key]) {
    connectionPromises[key] = (async () => {
      const dir = await getDevflowDir();
      const raw = await Database.load(
        `sqlite:${dir}/data/${projectId}.db`,
      );
      const db = new SerializedDatabase(raw);
      await db.execute("PRAGMA journal_mode = WAL");
      await db.execute("PRAGMA busy_timeout = 5000");
      await initProjectSchema(db as unknown as Database);
      connections[key] = db;
      return db;
    })();
  }
  return connectionPromises[key];
}
