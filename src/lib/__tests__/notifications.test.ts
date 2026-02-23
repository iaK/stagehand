import { vi } from "vitest";
import { sendNotification, requestNotificationPermission, registerNotificationClickHandler } from "../notifications";
import { toast } from "sonner";
import {
  isPermissionGranted,
  requestPermission,
  sendNotification as tauriSendNotification,
  onAction,
} from "@tauri-apps/plugin-notification";
import { useProjectStore } from "../../stores/projectStore";
import { useTaskStore } from "../../stores/taskStore";
import type { Task, Project } from "../types";

const mockIsPermissionGranted = vi.mocked(isPermissionGranted);
const mockRequestPermission = vi.mocked(requestPermission);
const mockTauriSendNotification = vi.mocked(tauriSendNotification);
const mockOnAction = vi.mocked(onAction);

describe("sendNotification", () => {
  let originalHiddenDescriptor: PropertyDescriptor | undefined;

  beforeEach(() => {
    originalHiddenDescriptor = Object.getOwnPropertyDescriptor(document, "hidden");
  });

  afterEach(() => {
    if (originalHiddenDescriptor) {
      Object.defineProperty(document, "hidden", originalHiddenDescriptor);
    } else {
      delete (document as unknown as Record<string, unknown>)["hidden"];
    }
  });

  it("sends Tauri notification with extra when document is hidden and permission granted", async () => {
    Object.defineProperty(document, "hidden", {
      value: true,
      configurable: true,
    });
    mockIsPermissionGranted.mockResolvedValue(true);

    await sendNotification("Stage complete", "Research needs review", "info", { projectId: "proj-1", taskId: "task-1" });

    expect(mockTauriSendNotification).toHaveBeenCalledWith({
      title: "Stage complete",
      body: "Research needs review",
      extra: { projectId: "proj-1", taskId: "task-1" },
    });
    expect(toast).not.toHaveBeenCalled();
  });

  it("sends Tauri notification with extra undefined when no context provided", async () => {
    Object.defineProperty(document, "hidden", {
      value: true,
      configurable: true,
    });
    mockIsPermissionGranted.mockResolvedValue(true);

    await sendNotification("Stage complete", "Research needs review", "success");

    expect(mockTauriSendNotification).toHaveBeenCalledWith({
      title: "Stage complete",
      body: "Research needs review",
      extra: undefined,
    });
    expect(toast.success).not.toHaveBeenCalled();
    expect(toast.error).not.toHaveBeenCalled();
    expect(toast.info).not.toHaveBeenCalled();
  });

  it("falls back to toast.info when document is hidden but permission not granted", async () => {
    Object.defineProperty(document, "hidden", {
      value: true,
      configurable: true,
    });
    mockIsPermissionGranted.mockResolvedValue(false);

    await sendNotification("Stage complete", "body text");

    expect(mockTauriSendNotification).not.toHaveBeenCalled();
    expect(toast.info).toHaveBeenCalledWith("Stage complete", {
      description: "body text",
    });
  });

  it("uses toast when document is visible", async () => {
    Object.defineProperty(document, "hidden", {
      value: false,
      configurable: true,
    });

    await sendNotification("Stage complete", "body text", "success");

    expect(mockTauriSendNotification).not.toHaveBeenCalled();
    expect(toast.success).toHaveBeenCalledWith("Stage complete", {
      description: "body text",
    });
  });

  it("falls back to toast when Tauri API throws", async () => {
    Object.defineProperty(document, "hidden", {
      value: true,
      configurable: true,
    });
    mockIsPermissionGranted.mockRejectedValue(new Error("Tauri not available"));

    await sendNotification("Stage complete", "body text", "error");

    expect(toast.error).toHaveBeenCalledWith("Stage complete", {
      description: "body text",
    });
  });

  it("calls toast.success for success type", async () => {
    Object.defineProperty(document, "hidden", {
      value: false,
      configurable: true,
    });

    await sendNotification("Done", "All good", "success");

    expect(toast.success).toHaveBeenCalledWith("Done", { description: "All good" });
    expect(toast.error).not.toHaveBeenCalled();
    expect(toast.info).not.toHaveBeenCalled();
  });

  it("calls toast.error for error type", async () => {
    Object.defineProperty(document, "hidden", {
      value: false,
      configurable: true,
    });

    await sendNotification("Failed", "Something broke", "error");

    expect(toast.error).toHaveBeenCalledWith("Failed", { description: "Something broke" });
    expect(toast.success).not.toHaveBeenCalled();
    expect(toast.info).not.toHaveBeenCalled();
  });

  it("calls toast.info for info type", async () => {
    Object.defineProperty(document, "hidden", {
      value: false,
      configurable: true,
    });

    await sendNotification("Notice", "FYI", "info");

    expect(toast.info).toHaveBeenCalledWith("Notice", { description: "FYI" });
    expect(toast.success).not.toHaveBeenCalled();
    expect(toast.error).not.toHaveBeenCalled();
  });

  it("defaults to info type when no type is provided", async () => {
    Object.defineProperty(document, "hidden", {
      value: false,
      configurable: true,
    });

    await sendNotification("Update", "Something happened");

    expect(toast.info).toHaveBeenCalledWith("Update", { description: "Something happened" });
    expect(toast.success).not.toHaveBeenCalled();
    expect(toast.error).not.toHaveBeenCalled();
  });
});

describe("requestNotificationPermission", () => {
  it("returns true when permission is already granted", async () => {
    mockIsPermissionGranted.mockResolvedValue(true);

    const result = await requestNotificationPermission();

    expect(result).toBe(true);
    expect(mockRequestPermission).not.toHaveBeenCalled();
  });

  it("requests permission and returns true when granted", async () => {
    mockIsPermissionGranted.mockResolvedValue(false);
    mockRequestPermission.mockResolvedValue("granted");

    const result = await requestNotificationPermission();

    expect(result).toBe(true);
    expect(mockRequestPermission).toHaveBeenCalled();
  });

  it("requests permission and returns false when denied", async () => {
    mockIsPermissionGranted.mockResolvedValue(false);
    mockRequestPermission.mockResolvedValue("denied");

    const result = await requestNotificationPermission();

    expect(result).toBe(false);
    expect(mockRequestPermission).toHaveBeenCalled();
  });
});

describe("registerNotificationClickHandler", () => {
  it("calls onAction with a callback", async () => {
    await registerNotificationClickHandler();

    expect(mockOnAction).toHaveBeenCalledWith(expect.any(Function));
  });

  it("navigates to correct project and task when extra contains both", async () => {
    // Set up store state
    const mockProject: Project = { id: "proj-1", name: "Test Project", path: "/test", archived: 0, created_at: "", updated_at: "" };
    const mockTask: Task = { id: "task-1", title: "Test Task", status: "pending", project_id: "proj-1", current_stage_id: null, branch_name: null, worktree_path: null, pr_url: null, parent_task_id: null, ejected: 0, archived: 0, diff_insertions: null, diff_deletions: null, created_at: "", updated_at: "" };

    useProjectStore.setState({ projects: [mockProject] });

    const mockSetActiveProject = vi.fn();
    useProjectStore.setState({ setActiveProject: mockSetActiveProject });

    const mockLoadTasks = vi.fn(async () => {
      useTaskStore.setState({ tasks: [mockTask] });
    });
    const mockSetActiveTask = vi.fn();
    useTaskStore.setState({ loadTasks: mockLoadTasks, setActiveTask: mockSetActiveTask });

    // Capture the callback
    let capturedCallback: (event: unknown) => Promise<void>;
    mockOnAction.mockImplementation(async (cb) => {
      capturedCallback = cb as (event: unknown) => Promise<void>;
      return { plugin: "notification", event: "actionPerformed", channelId: 0, unregister: vi.fn() };
    });

    await registerNotificationClickHandler();

    // Simulate notification click
    await capturedCallback!({
      actionTypeId: "",
      id: 0,
      notification: {
        extra: { projectId: "proj-1", taskId: "task-1" },
      },
    });

    expect(mockSetActiveProject).toHaveBeenCalledWith(mockProject);
    expect(mockLoadTasks).toHaveBeenCalledWith("proj-1");
    expect(mockSetActiveTask).toHaveBeenCalledWith(mockTask);
  });

  it("handles missing extra gracefully", async () => {
    let capturedCallback: (event: unknown) => Promise<void>;
    mockOnAction.mockImplementation(async (cb) => {
      capturedCallback = cb as (event: unknown) => Promise<void>;
      return { plugin: "notification", event: "actionPerformed", channelId: 0, unregister: vi.fn() };
    });

    await registerNotificationClickHandler();

    // Should not throw
    await capturedCallback!({
      actionTypeId: "",
      id: 0,
      notification: {},
    });
  });

  it("handles projectId only — sets project but no task", async () => {
    const mockProject: Project = { id: "proj-2", name: "Project 2", path: "/test2", archived: 0, created_at: "", updated_at: "" };

    useProjectStore.setState({ projects: [mockProject] });

    const mockSetActiveProject = vi.fn();
    useProjectStore.setState({ setActiveProject: mockSetActiveProject });

    const mockSetActiveTask = vi.fn();
    useTaskStore.setState({ setActiveTask: mockSetActiveTask });

    let capturedCallback: (event: unknown) => Promise<void>;
    mockOnAction.mockImplementation(async (cb) => {
      capturedCallback = cb as (event: unknown) => Promise<void>;
      return { plugin: "notification", event: "actionPerformed", channelId: 0, unregister: vi.fn() };
    });

    await registerNotificationClickHandler();

    await capturedCallback!({
      actionTypeId: "",
      id: 0,
      notification: {
        extra: { projectId: "proj-2" },
      },
    });

    expect(mockSetActiveProject).toHaveBeenCalledWith(mockProject);
    expect(mockSetActiveTask).not.toHaveBeenCalled();
  });

  it("no-ops when project is not found", async () => {
    useProjectStore.setState({ projects: [] });

    const mockSetActiveProject = vi.fn();
    useProjectStore.setState({ setActiveProject: mockSetActiveProject });

    let capturedCallback: (event: unknown) => Promise<void>;
    mockOnAction.mockImplementation(async (cb) => {
      capturedCallback = cb as (event: unknown) => Promise<void>;
      return { plugin: "notification", event: "actionPerformed", channelId: 0, unregister: vi.fn() };
    });

    await registerNotificationClickHandler();

    await capturedCallback!({
      actionTypeId: "",
      id: 0,
      notification: {
        extra: { projectId: "nonexistent" },
      },
    });

    expect(mockSetActiveProject).not.toHaveBeenCalled();
  });
});
