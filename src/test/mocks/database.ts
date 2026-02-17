import { vi } from "vitest";

interface MockDatabaseInstance {
  execute: ReturnType<typeof vi.fn>;
  select: ReturnType<typeof vi.fn>;
  close: ReturnType<typeof vi.fn>;
}

export function createMockDatabase(): MockDatabaseInstance {
  return {
    execute: vi.fn().mockResolvedValue(undefined),
    select: vi.fn().mockResolvedValue([]),
    close: vi.fn().mockResolvedValue(undefined),
  };
}

const instances = new Map<string, MockDatabaseInstance>();

export function getMockDatabase(path: string): MockDatabaseInstance {
  let instance = instances.get(path);
  if (!instance) {
    instance = createMockDatabase();
    instances.set(path, instance);
  }
  return instance;
}

export function resetDatabaseMocks() {
  instances.clear();
}

export const Database = {
  load: vi.fn(async (path: string) => getMockDatabase(path)),
};
