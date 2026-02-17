import { toast } from "sonner";
import {
  isPermissionGranted,
  requestPermission,
  sendNotification as tauriSendNotification,
  onAction,
} from "@tauri-apps/plugin-notification";
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

export async function sendNotification(title: string, body?: string, context?: NotificationContext) {
  if (document.hidden) {
    try {
      const granted = await isPermissionGranted();
      if (granted) {
        tauriSendNotification({ title, body, extra: context ? { ...context } : undefined });
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

export async function registerNotificationClickHandler() {
  return onAction(async (event) => {
    const extra = (event.notification as { extra?: NotificationContext }).extra;
    if (!extra?.projectId) return;

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
