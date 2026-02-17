import { vi } from "vitest";
import { sendNotification } from "../notifications";
import { toast } from "sonner";

describe("sendNotification", () => {
  let instances: Array<{ onclick: (() => void) | null; close: ReturnType<typeof vi.fn> }>;

  beforeEach(() => {
    instances = [];

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
