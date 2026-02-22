import Database from "@tauri-apps/plugin-sql";
import type { QueryResult } from "@tauri-apps/plugin-sql";
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
 * Wraps a Database connection to serialize all operations through a queue.
 * This prevents SQLite "database is locked" errors caused by sqlx's connection
 * pool dispatching concurrent operations to different connections.
 */
class SerializedDatabase {
  private queue: Promise<void> = Promise.resolve();

  constructor(private db: Database) {}

  get path(): string {
    return this.db.path;
  }

  execute(query: string, bindValues?: unknown[]): Promise<QueryResult> {
    return this.enqueue(() =>
      this.retryOnLocked(() => this.db.execute(query, bindValues)),
    );
  }

  select<T>(query: string, bindValues?: unknown[]): Promise<T> {
    return this.enqueue(() =>
      this.retryOnLocked(() => this.db.select<T>(query, bindValues)),
    );
  }

  close(db?: string): Promise<boolean> {
    return this.enqueue(() => this.db.close(db));
  }

  private enqueue<T>(fn: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      this.queue = this.queue.then(() => fn().then(resolve, reject));
    });
  }

  private async retryOnLocked<T>(fn: () => Promise<T>): Promise<T> {
    const MAX_RETRIES = 4;
    const BASE_DELAY = 100;
    for (let attempt = 0; ; attempt++) {
      try {
        return await fn();
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        if (msg.includes("database is locked") && attempt < MAX_RETRIES) {
          await new Promise((r) => setTimeout(r, BASE_DELAY * 2 ** attempt));
          continue;
        }
        throw e;
      }
    }
  }
}

// Use Database type for consumers, but store SerializedDatabase instances
const connections: Record<string, SerializedDatabase> = {};
const connectionPromises: Record<string, Promise<SerializedDatabase>> = {};

export async function getAppDb(): Promise<Database> {
  if (connections["app"]) return connections["app"] as unknown as Database;
  if (!connectionPromises["app"]) {
    connectionPromises["app"] = (async () => {
      const dir = await getDevflowDir();
      const raw = await Database.load(`sqlite:${dir}/app.db`);
      const db = new SerializedDatabase(raw);
      // WAL mode persists on the DB file; busy_timeout is belt-and-suspenders
      await db.execute("PRAGMA journal_mode = WAL;", []);
      await db.execute("PRAGMA busy_timeout = 5000;", []);
      await initAppSchema(db as unknown as Database);
      connections["app"] = db;
      return db;
    })();
  }
  return connectionPromises["app"] as unknown as Promise<Database>;
}

export async function getProjectDb(projectId: string): Promise<Database> {
  const key = `project:${projectId}`;
  if (connections[key]) return connections[key] as unknown as Database;
  if (!connectionPromises[key]) {
    connectionPromises[key] = (async () => {
      const dir = await getDevflowDir();
      const raw = await Database.load(`sqlite:${dir}/data/${projectId}.db`);
      const db = new SerializedDatabase(raw);
      await db.execute("PRAGMA journal_mode = WAL;", []);
      await db.execute("PRAGMA busy_timeout = 5000;", []);
      await initProjectSchema(db as unknown as Database);
      connections[key] = db;
      return db;
    })();
  }
  return connectionPromises[key] as unknown as Promise<Database>;
}
