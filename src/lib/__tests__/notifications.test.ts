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

    await sendNotification("Stage complete", "Research needs review");

    expect(mockTauriSendNotification).toHaveBeenCalledWith({
      title: "Stage complete",
      body: "Research needs review",
    });
    expect(toast).not.toHaveBeenCalled();
  });

  it("falls back to toast when document is hidden but permission not granted", async () => {
    Object.defineProperty(document, "hidden", {
      value: true,
      configurable: true,
    });
    mockIsPermissionGranted.mockResolvedValue(false);

    await sendNotification("Stage complete", "body text");

    expect(mockTauriSendNotification).not.toHaveBeenCalled();
    expect(toast).toHaveBeenCalledWith("Stage complete", {
      description: "body text",
    });
  });

  it("uses toast when document is visible", async () => {
    Object.defineProperty(document, "hidden", {
      value: false,
      configurable: true,
    });

    await sendNotification("Stage complete", "body text");

    expect(mockTauriSendNotification).not.toHaveBeenCalled();
    expect(toast).toHaveBeenCalledWith("Stage complete", {
      description: "body text",
    });
  });

  it("falls back to toast when Tauri API throws", async () => {
    Object.defineProperty(document, "hidden", {
      value: true,
      configurable: true,
    });
    mockIsPermissionGranted.mockRejectedValue(new Error("Tauri not available"));

    await sendNotification("Stage complete", "body text");

    expect(toast).toHaveBeenCalledWith("Stage complete", {
      description: "body text",
    });
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
