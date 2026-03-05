/**
 * Global PTY output routing. Decouples PTY output from component lifecycle
 * so terminal sessions survive task/project switches.
 *
 * When a terminal component is mounted, it registers a writer function.
 * PTY output is routed to the writer. When no writer is registered (e.g.
 * the user switched to a different task), output is buffered and replayed
 * when a writer re-registers.
 */

type PtyWriter = (data: string) => void;

const writers = new Map<string, PtyWriter>();
const buffers = new Map<string, string>();

const MAX_BUFFER_SIZE = 512 * 1024; // 512KB per task

/** Register a writer for a task. Flushes any buffered output immediately. */
export function registerPtyWriter(taskId: string, writer: PtyWriter): void {
  writers.set(taskId, writer);
  const buffered = buffers.get(taskId);
  if (buffered) {
    writer(buffered);
    buffers.delete(taskId);
  }
}

/** Unregister the writer for a task. Future output will be buffered. */
export function unregisterPtyWriter(taskId: string): void {
  writers.delete(taskId);
}

/** Route PTY output to the registered writer, or buffer it. */
export function routePtyOutput(taskId: string, data: string): void {
  const writer = writers.get(taskId);
  if (writer) {
    writer(data);
  } else {
    let existing = buffers.get(taskId) ?? "";
    existing += data;
    if (existing.length > MAX_BUFFER_SIZE) {
      existing = existing.slice(-MAX_BUFFER_SIZE);
    }
    buffers.set(taskId, existing);
  }
}

/** Clear buffered output only (keeps writer registered). */
export function clearPtyBuffer(taskId: string): void {
  buffers.delete(taskId);
}

/** Clear buffered output and writer for a task (called on session end / kill). */
export function clearPtyRoute(taskId: string): void {
  buffers.delete(taskId);
  writers.delete(taskId);
}
