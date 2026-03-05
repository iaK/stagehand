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
import { useProcessStore } from "../stores/processStore";

export interface NotificationContext {
  projectId?: string;
  taskId?: string;
  openTerminal?: boolean;
}

async function navigateToContext(context: NotificationContext) {
  if (!context.projectId) return;

  const { projects, setActiveProject } = useProjectStore.getState();
  const project = projects.find((p) => p.id === context.projectId);
  if (!project) return;

  setActiveProject(project);

  if (context.taskId) {
    await useTaskStore.getState().loadTasks(context.projectId);
    const tasks = useTaskStore.getState().tasks;
    const task = tasks.find((t) => t.id === context.taskId);
    if (task) {
      useTaskStore.getState().setActiveTask(task);
    }
  }

  if (context.openTerminal) {
    useProcessStore.getState().setTerminalOpen(true);
  }
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
    const opts: Record<string, unknown> = { description: body };
    if (context?.projectId) {
      opts.onClick = () => navigateToContext(context);
      opts.className = "cursor-pointer";
    }
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
    const extra = ((event as unknown as { notification?: { extra?: NotificationContext } }).notification?.extra);
    if (!extra?.projectId) return;

    await getCurrentWindow().setFocus();
    await navigateToContext(extra);
  });
}
