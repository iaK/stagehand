import { vi } from "vitest";
import { sendNotification, requestNotificationPermission } from "../notifications";
import { toast } from "sonner";
import {
  isPermissionGranted,
  requestPermission,
  sendNotification as tauriSendNotification,
} from "@tauri-apps/plugin-notification";

const mockIsPermissionGranted = vi.mocked(isPermissionGranted);
const mockRequestPermission = vi.mocked(requestPermission);
const mockTauriSendNotification = vi.mocked(tauriSendNotification);

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

  it("sends Tauri notification when document is hidden and permission granted", async () => {
    Object.defineProperty(document, "hidden", {
      value: true,
      configurable: true,
    });
    mockIsPermissionGranted.mockResolvedValue(true);

    await sendNotification("Stage complete", "Research needs review", "success");

    expect(mockTauriSendNotification).toHaveBeenCalledWith({
      title: "Stage complete",
      body: "Research needs review",
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
