import type Database from "@tauri-apps/plugin-sql";

export async function withTransaction<T>(db: Database, fn: () => Promise<T>): Promise<T> {
  await db.execute("BEGIN");
  try {
    const result = await fn();
    await db.execute("COMMIT");
    return result;
  } catch (e) {
    try {
      await db.execute("ROLLBACK");
    } catch {
      // Transaction may have already been rolled back by SQLite
    }
    throw e;
  }
}
