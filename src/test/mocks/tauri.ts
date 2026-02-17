import { vi } from "vitest";

type InvokeHandler = (...args: unknown[]) => unknown;

const handlers = new Map<string, InvokeHandler>();

export function mockInvoke(command: string, handler: InvokeHandler) {
  handlers.set(command, handler);
}

export function resetInvokeMocks() {
  handlers.clear();
}

export const invoke = vi.fn(async (command: string, ...args: unknown[]) => {
  const handler = handlers.get(command);
  if (handler) return handler(...args);
  throw new Error(`No mock handler registered for invoke("${command}")`);
});
