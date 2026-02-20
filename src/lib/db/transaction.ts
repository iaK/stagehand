import type Database from "@tauri-apps/plugin-sql";

export async function withTransaction<T>(db: Database, fn: () => Promise<T>): Promise<T> {
  await db.execute("BEGIN");
  try {
    const result = await fn();
    await db.execute("COMMIT");
    return result;
  } catch (e) {
    await db.execute("ROLLBACK");
    throw e;
  }
}
