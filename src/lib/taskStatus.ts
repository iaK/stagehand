// Status dot colors (shared across TaskList and project status indicators)
export const statusColors: Record<string, string> = {
  pending: "bg-zinc-400",
  in_progress: "bg-blue-500",
  completed: "bg-emerald-500",
  failed: "bg-red-500",
  split: "bg-violet-500",
};

export const pipelineColors: Record<string, string> = {
  running: "bg-blue-500 animate-pulse",
  awaiting_user: "bg-amber-500",
  approved: "bg-emerald-500",
  failed: "bg-red-500",
  pending: "bg-zinc-400",
};

// Priority ranking: higher index = more urgent
const urgencyOrder: string[] = [
  "completed",     // 0 - all done (green)
  "split",         // 1 - terminal, task decomposed (violet)
  "approved",      // 2 - stage done (green)
  "pending",       // 3 - waiting (gray)
  "in_progress",   // 4 - active (blue)
  "running",       // 5 - active (blue, pulsing)
  "failed",        // 6 - error (red)
  "awaiting_user", // 7 - needs human action (amber) — most urgent
];

export function statusUrgency(status: string): number {
  const idx = urgencyOrder.indexOf(status);
  return idx === -1 ? -1 : idx;
}

// Given arrays of task statuses and execution statuses, return the
// single most-urgent dot color class.
export function aggregateProjectDotClass(
  taskStatuses: string[],
  execStatuses: string[],
): string {
  if (taskStatuses.length === 0) return "bg-zinc-400";

  let maxUrgency = -1;
  let maxStatus = "pending";

  for (const status of taskStatuses) {
    const u = statusUrgency(status);
    if (u > maxUrgency) {
      maxUrgency = u;
      maxStatus = status;
    }
  }

  for (const status of execStatuses) {
    const u = statusUrgency(status);
    if (u > maxUrgency) {
      maxUrgency = u;
      maxStatus = status;
    }
  }

  return pipelineColors[maxStatus] ?? statusColors[maxStatus] ?? "bg-zinc-400";
}
