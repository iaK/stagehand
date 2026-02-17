import { toast } from "sonner";

export function requestNotificationPermission() {
  if ("Notification" in window && Notification.permission === "default") {
    Notification.requestPermission();
  }
}

export function sendNotification(title: string, body?: string) {
  if (document.hidden) {
    // Window not focused — try native OS notification
    if (
      "Notification" in window &&
      Notification.permission === "granted"
    ) {
      const n = new Notification(title, { body });
      n.onclick = () => {
        window.focus();
        n.close();
      };
    } else {
      // Permission not granted — fall back to toast (visible when user returns)
      toast(title, { description: body });
    }
  } else {
    // Window focused — in-app toast
    toast(title, { description: body });
  }
}
