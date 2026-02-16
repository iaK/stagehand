import { toast } from "sonner";

export function requestNotificationPermission() {
  if ("Notification" in window && Notification.permission === "default") {
    Notification.requestPermission();
  }
}

export function sendNotification(title: string, body?: string) {
  if (document.hidden) {
    // Window not focused — native OS notification
    if (
      "Notification" in window &&
      Notification.permission === "granted"
    ) {
      const n = new Notification(title, { body });
      n.onclick = () => {
        window.focus();
        n.close();
      };
    }
  } else {
    // Window focused — in-app toast
    toast(title, { description: body });
  }
}
