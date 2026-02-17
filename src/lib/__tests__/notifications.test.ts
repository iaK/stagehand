import { vi } from "vitest";
import { sendNotification, requestNotificationPermission } from "../notifications";
import { toast } from "sonner";

describe("sendNotification", () => {
  let instances: Array<{ onclick: (() => void) | null; close: ReturnType<typeof vi.fn> }>;
  let originalHiddenDescriptor: PropertyDescriptor | undefined;

  beforeEach(() => {
    instances = [];
    originalHiddenDescriptor = Object.getOwnPropertyDescriptor(document, "hidden");

    // Mock Notification as a proper class
    class MockNotification {
      onclick: (() => void) | null = null;
      close = vi.fn();
      static permission = "granted";
      constructor(public title: string, public options?: { body?: string }) {
        instances.push(this);
      }
    }

    vi.stubGlobal("Notification", MockNotification);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    // Restore original document.hidden descriptor
    if (originalHiddenDescriptor) {
      Object.defineProperty(document, "hidden", originalHiddenDescriptor);
    } else {
      // If there was no own property, delete our override so the prototype value is used
      delete (document as unknown as Record<string, unknown>)["hidden"];
    }
  });

  it("creates native Notification when document is hidden and permission granted", () => {
    Object.defineProperty(document, "hidden", {
      value: true,
      configurable: true,
    });

    sendNotification("Stage complete", "Research needs review");

    expect(instances).toHaveLength(1);
    expect(instances[0]).toMatchObject({
      title: "Stage complete",
      options: { body: "Research needs review" },
    });
    expect(toast).not.toHaveBeenCalled();
  });

  it("falls back to toast when document is hidden but no Notification support", () => {
    Object.defineProperty(document, "hidden", {
      value: true,
      configurable: true,
    });

    // Remove Notification from window
    vi.stubGlobal("Notification", undefined);
    // @ts-expect-error - deliberately removing Notification
    delete window.Notification;

    sendNotification("Stage complete", "body text");

    expect(toast).toHaveBeenCalledWith("Stage complete", {
      description: "body text",
    });
  });

  it("uses toast when document is visible", () => {
    Object.defineProperty(document, "hidden", {
      value: false,
      configurable: true,
    });

    sendNotification("Stage complete", "body text");

    expect(toast).toHaveBeenCalledWith("Stage complete", {
      description: "body text",
    });
  });

  it("notification click handler focuses window and closes notification", () => {
    Object.defineProperty(document, "hidden", {
      value: true,
      configurable: true,
    });

    const focusSpy = vi.spyOn(window, "focus").mockImplementation(() => {});

    sendNotification("Test", "body");

    expect(instances).toHaveLength(1);
    const notification = instances[0];
    expect(notification.onclick).toBeDefined();
    notification.onclick!();

    expect(focusSpy).toHaveBeenCalled();
    expect(notification.close).toHaveBeenCalled();
  });
});

describe("requestNotificationPermission", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("calls requestPermission when permission is default", () => {
    const requestPermission = vi.fn();
    vi.stubGlobal("Notification", {
      permission: "default",
      requestPermission,
    });

    requestNotificationPermission();

    expect(requestPermission).toHaveBeenCalled();
  });

  it("does not call requestPermission when permission is granted", () => {
    const requestPermission = vi.fn();
    vi.stubGlobal("Notification", {
      permission: "granted",
      requestPermission,
    });

    requestNotificationPermission();

    expect(requestPermission).not.toHaveBeenCalled();
  });

  it("does not call requestPermission when permission is denied", () => {
    const requestPermission = vi.fn();
    vi.stubGlobal("Notification", {
      permission: "denied",
      requestPermission,
    });

    requestNotificationPermission();

    expect(requestPermission).not.toHaveBeenCalled();
  });

  it("does nothing when Notification is not in window", () => {
    vi.stubGlobal("Notification", undefined);
    // @ts-expect-error - deliberately removing Notification
    delete window.Notification;

    // Should not throw
    expect(() => requestNotificationPermission()).not.toThrow();
  });
});
