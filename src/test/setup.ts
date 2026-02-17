import "@testing-library/jest-dom";
import { vi } from "vitest";
import { invoke, resetInvokeMocks } from "./mocks/tauri";
import { Database, resetDatabaseMocks } from "./mocks/database";

// Mock @tauri-apps/api/core
vi.mock("@tauri-apps/api/core", () => ({
  invoke,
}));

// Mock @tauri-apps/plugin-sql
vi.mock("@tauri-apps/plugin-sql", () => ({
  default: Database,
}));

// Mock @tauri-apps/plugin-dialog
vi.mock("@tauri-apps/plugin-dialog", () => ({
  open: vi.fn(),
  save: vi.fn(),
  message: vi.fn(),
  ask: vi.fn(),
  confirm: vi.fn(),
}));

// Mock @tauri-apps/plugin-notification
vi.mock("@tauri-apps/plugin-notification", () => ({
  isPermissionGranted: vi.fn(async () => true),
  requestPermission: vi.fn(async () => "granted" as const),
  sendNotification: vi.fn(),
  onAction: vi.fn(async () => ({ unregister: vi.fn() })),
  registerActionTypes: vi.fn(async () => {}),
  onNotificationReceived: vi.fn(async () => ({ unregister: vi.fn() })),
}));

// Mock @tauri-apps/api/path
vi.mock("@tauri-apps/api/path", () => ({
  join: vi.fn(async (...parts: string[]) => parts.join("/")),
  appDataDir: vi.fn(async () => "/mock/app-data"),
  resolve: vi.fn(async (...parts: string[]) => parts.join("/")),
}));

// Mock sonner toast
const toastFn = Object.assign(vi.fn(), {
  success: vi.fn(),
  error: vi.fn(),
  info: vi.fn(),
});
vi.mock("sonner", () => ({
  toast: toastFn,
  Toaster: () => null,
}));

// Reset all mocks between tests
beforeEach(() => {
  resetInvokeMocks();
  resetDatabaseMocks();
  vi.clearAllMocks();
});
