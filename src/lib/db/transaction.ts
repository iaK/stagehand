import type Database from "@tauri-apps/plugin-sql";

const MAX_RETRIES = 3;
const BASE_DELAY_MS = 200;

function isDatabaseLocked(e: unknown): boolean {
  if (e instanceof Error) {
    return e.message.includes("database is locked");
  }
  return String(e).includes("database is locked");
}

export async function withTransaction<T>(db: Database, fn: () => Promise<T>): Promise<T> {
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      await db.execute("BEGIN IMMEDIATE");
    } catch (e) {
      if (isDatabaseLocked(e) && attempt < MAX_RETRIES) {
        await new Promise((r) => setTimeout(r, BASE_DELAY_MS * 2 ** attempt));
        continue;
      }
      throw e;
    }
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
      if (isDatabaseLocked(e) && attempt < MAX_RETRIES) {
        await new Promise((r) => setTimeout(r, BASE_DELAY_MS * 2 ** attempt));
        continue;
      }
      throw e;
    }
  }
  // Unreachable, but TypeScript needs it
  throw new Error("withTransaction: exhausted retries");
}
