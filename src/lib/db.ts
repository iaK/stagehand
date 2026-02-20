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

const connections: Record<string, Database> = {};
const connectionPromises: Record<string, Promise<Database>> = {};

export async function getAppDb(): Promise<Database> {
  if (connections["app"]) return connections["app"];
  if (!connectionPromises["app"]) {
    connectionPromises["app"] = (async () => {
      const dir = await getDevflowDir();
      const db = await Database.load(`sqlite:${dir}/app.db`);
      await initAppSchema(db);
      connections["app"] = db;
      return db;
    })();
  }
  return connectionPromises["app"];
}

export async function getProjectDb(projectId: string): Promise<Database> {
  const key = `project:${projectId}`;
  if (connections[key]) return connections[key];
  if (!connectionPromises[key]) {
    connectionPromises[key] = (async () => {
      const dir = await getDevflowDir();
      const db = await Database.load(
        `sqlite:${dir}/data/${projectId}.db`,
      );
      await initProjectSchema(db);
      connections[key] = db;
      return db;
    })();
  }
  return connectionPromises[key];
}
