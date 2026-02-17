import { toast } from "sonner";
import {
  isPermissionGranted,
  requestPermission,
  sendNotification as tauriSendNotification,
  onAction,
} from "@tauri-apps/plugin-notification";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useProjectStore } from "../stores/projectStore";
import { useTaskStore } from "../stores/taskStore";

export interface NotificationContext {
  projectId?: string;
  taskId?: string;
}

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
  context?: NotificationContext,
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
        tauriSendNotification({ title, body, extra: context ? { ...context } : undefined });
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

export async function registerNotificationClickHandler() {
  return onAction(async (event) => {
    const extra = (event.notification as { extra?: NotificationContext }).extra;
    if (!extra?.projectId) return;

    await getCurrentWindow().setFocus();

    const { projects, setActiveProject } = useProjectStore.getState();
    const project = projects.find((p) => p.id === extra.projectId);
    if (!project) return;

    setActiveProject(project);

    if (extra.taskId) {
      await useTaskStore.getState().loadTasks(extra.projectId);
      const tasks = useTaskStore.getState().tasks;
      const task = tasks.find((t) => t.id === extra.taskId);
      if (task) {
        useTaskStore.getState().setActiveTask(task);
      }
    }
  });
}
