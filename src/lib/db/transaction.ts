/**
 * Runs a batch of database operations sequentially.
 *
 * NOTE: We cannot use SQLite BEGIN/COMMIT/ROLLBACK through the Tauri SQL
 * plugin because it uses an sqlx connection *pool* under the hood.  Each
 * db.execute() call may be dispatched to a different pool connection, so
 * BEGIN on connection A, DELETE on connection B, and COMMIT on connection C
 * is entirely possible — which breaks transactions completely.
 *
 * Instead we rely on the SerializedDatabase wrapper (see db.ts) which
 * funnels every execute/select call through a single promise queue,
 * guaranteeing that no two operations overlap.  This gives us the same
 * concurrency protection as a transaction (no interleaved writes from other
 * code paths) at the cost of losing automatic rollback on partial failure.
 *
 * For the call-sites that use this (setTaskStages, reorderStageTemplates,
 * duplicateStageTemplate), partial failure is recoverable by retrying.
 */
export async function withTransaction<T>(
  _db: unknown,
  fn: () => Promise<T>,
): Promise<T> {
  return fn();
}
