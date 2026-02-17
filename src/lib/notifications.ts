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

export async function sendNotification(title: string, body?: string) {
  if (document.hidden) {
    try {
      const granted = await isPermissionGranted();
      if (granted) {
        tauriSendNotification({ title, body });
      } else {
        toast(title, { description: body });
      }
    } catch {
      toast(title, { description: body });
    }
  } else {
    toast(title, { description: body });
  }
}
