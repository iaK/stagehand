import { toast } from "sonner";
import {
  isPermissionGranted,
  requestPermission,
  sendNotification as tauriSendNotification,
} from "@tauri-apps/plugin-notification";

export async function requestNotificationPermission() {
  let granted = await isPermissionGranted();
  if (!granted) {
    const permission = await requestPermission();
    granted = permission === "granted";
  }
  return granted;
}

export async function sendNotification(
  title: string,
  body?: string,
  type: "success" | "error" | "info" = "info",
) {
  const showToast = () => {
    const opts = { description: body };
    switch (type) {
      case "success":
        return toast.success(title, opts);
      case "error":
        return toast.error(title, opts);
      case "info":
        return toast.info(title, opts);
    }
  };

  if (document.hidden) {
    try {
      const granted = await isPermissionGranted();
      if (granted) {
        tauriSendNotification({ title, body });
      } else {
        showToast();
      }
    } catch {
      showToast();
    }
  } else {
    showToast();
  }
}
