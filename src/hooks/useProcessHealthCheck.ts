import { useEffect, useRef } from "react";
import { useProjectStore } from "../stores/projectStore";
import { useTaskStore } from "../stores/taskStore";
import { useProcessStore, stageKey } from "../stores/processStore";
import { listProcessesDetailed, killProcess } from "../lib/claude";
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
  const loadExecutions = useTaskStore((s) => s.loadExecutions);
  const sk = stageId && activeTask ? stageKey(activeTask.id, stageId) : null;
  const stageIsRunning = useProcessStore((s) => sk ? (s.stages[sk]?.isRunning ?? false) : false);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (!stageId || !activeProject || !activeTask) return;

    const projectId = activeProject.id;
    const taskId = activeTask.id;
    const sk = stageKey(taskId, stageId);

    // Check both process store running state and execution status
    if (!stageIsRunning) {
      const executions = useTaskStore.getState().executions;
      const hasRunning = executions.some(
        (e) => e.stage_template_id === stageId && e.status === "running",
      );
      if (!hasRunning) return;
    }

    const check = async () => {
      // Read fresh executions at check time (non-reactive)
      const currentExecs = useTaskStore.getState().executions;
      const stillRunning = currentExecs.some(
        (e) => e.stage_template_id === stageId && e.status === "running",
      );
      if (!stillRunning) return;

      const stageState = useProcessStore.getState().stages[sk];
      const processId = stageState?.processId;

      // Check 1: Is the process still tracked by the backend?
      try {
        const detailedProcesses = await listProcessesDetailed();
        const runningIds = detailedProcesses.map((p) => p.processId);

        if (processId && !runningIds.includes(processId)) {
          // Process is gone — mark as crashed
          await markStageCrashed(projectId, stageId, taskId, "Process crashed unexpectedly");
          useProcessStore.getState().setStopped(sk);
          await loadExecutions(projectId, taskId);
          return;
        }

        if (!processId) {
          // Post-reload: processStore has no info, check by execution ID
          const runningExec = useTaskStore.getState().executions.find(
            (e) => e.stage_template_id === stageId && e.status === "running",
          );
          if (!runningExec) return;

          const matchedProcess = detailedProcesses.find(
            (p) => p.stageExecutionId === runningExec.id,
          );

          if (matchedProcess) {
            // Backend process exists but Channel is dead — kill it
            try {
              await killProcess(matchedProcess.processId);
            } catch {
              // May already be exiting
            }
          }
          // Either way, mark the execution as failed
          await markStageCrashed(projectId, stageId, taskId, "Process lost connection");
          useProcessStore.getState().setStopped(sk);
          await loadExecutions(projectId, taskId);
          return;
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
  }, [stageId, activeProject?.id, activeTask?.id, loadExecutions, stageIsRunning]);
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
