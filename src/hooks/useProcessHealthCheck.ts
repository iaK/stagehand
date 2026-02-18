import { useEffect, useRef } from "react";
import { useProjectStore } from "../stores/projectStore";
import { useTaskStore } from "../stores/taskStore";
import { useProcessStore, stageKey } from "../stores/processStore";
import { listProcesses } from "../lib/claude";
import * as repo from "../lib/repositories";

const POLL_INTERVAL_MS = 5_000;
const INACTIVITY_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes

/**
 * Periodically checks that running processes are still alive.
 * If a process disappears from the backend or goes silent for too long,
 * marks the execution as failed so the user can retry.
 */
export function useProcessHealthCheck(stageId: string | null) {
  const activeProject = useProjectStore((s) => s.activeProject);
  const activeTask = useTaskStore((s) => s.activeTask);
  const executions = useTaskStore((s) => s.executions);
  const loadExecutions = useTaskStore((s) => s.loadExecutions);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (!stageId || !activeProject || !activeTask) return;

    // Find a "running" execution for this stage
    const hasRunning = executions.some(
      (e) => e.stage_template_id === stageId && e.status === "running",
    );

    if (!hasRunning) {
      // No running execution — clear any existing interval
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
      return;
    }

    // Start polling
    const projectId = activeProject.id;
    const taskId = activeTask.id;
    const sk = stageKey(taskId, stageId);

    const check = async () => {
      const stageState = useProcessStore.getState().stages[sk];
      const processId = stageState?.processId;

      // Check 1: Is the process still tracked by the backend?
      try {
        const running = await listProcesses();
        if (processId && !running.includes(processId)) {
          // Process is gone — mark the execution as crashed
          await markStageCrashed(projectId, stageId, taskId, "Process crashed unexpectedly");
          useProcessStore.getState().setStopped(sk);
          await loadExecutions(projectId, taskId);
          return;
        }

        // No process tracked in the store and no backend processes —
        // the execution is stale (e.g. app restart, process crashed without cleanup).
        // Mark it as failed directly rather than relying solely on loadExecutions
        // stale detection (which skips cleanup when other processes are running).
        if (!processId || !stageState?.isRunning) {
          if (!running.includes(processId ?? "")) {
            await markStageCrashed(projectId, stageId, taskId, "Process crashed or was interrupted");
            useProcessStore.getState().setStopped(sk);
            await loadExecutions(projectId, taskId);
            return;
          }
        }
      } catch {
        // Backend unreachable — skip this check
      }

      // Check 2: Inactivity timeout
      const lastOutput = stageState?.lastOutputAt;
      if (lastOutput && Date.now() - lastOutput > INACTIVITY_TIMEOUT_MS) {
        await markStageCrashed(
          projectId,
          stageId,
          taskId,
          "Process timed out (no output for 10 minutes)",
        );
        useProcessStore.getState().setStopped(sk);
        await loadExecutions(projectId, taskId);
      }
    };

    intervalRef.current = setInterval(check, POLL_INTERVAL_MS);

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [stageId, activeProject, activeTask, executions, loadExecutions]);
}

async function markStageCrashed(
  projectId: string,
  stageId: string,
  taskId: string,
  message: string,
) {
  const executions = await repo.listStageExecutions(projectId, taskId);
  for (const exec of executions) {
    if (exec.stage_template_id === stageId && exec.status === "running") {
      await repo.updateStageExecution(projectId, exec.id, {
        status: "failed",
        error_message: message,
        completed_at: new Date().toISOString(),
      });
    }
  }
}
