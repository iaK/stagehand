import { useEffect } from "react";
import { listProcessesDetailed, killProcess } from "../lib/claude";
import { useProcessStore } from "../stores/processStore";
import { useProjectStore } from "../stores/projectStore";
import { useTaskStore } from "../stores/taskStore";
import * as repo from "../lib/repositories";

export function useOrphanedProcessCleanup() {
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const processes = await listProcessesDetailed();
        if (cancelled || processes.length === 0) return;

        const storeStages = useProcessStore.getState().stages;
        const knownProcessIds = new Set(
          Object.values(storeStages)
            .map((s) => s.processId)
            .filter(Boolean),
        );

        const orphans = processes.filter((p) => !knownProcessIds.has(p.processId));

        for (const proc of orphans) {
          // Kill the orphaned backend process
          try {
            await killProcess(proc.processId);
          } catch {
            // May already be exiting
          }

          // Mark the corresponding DB execution as failed
          if (proc.stageExecutionId) {
            const projectId = useProjectStore.getState().activeProject?.id;
            const taskId = useTaskStore.getState().activeTask?.id;
            if (projectId && taskId) {
              try {
                await repo.updateStageExecution(projectId, proc.stageExecutionId, {
                  status: "failed",
                  error_message: "Process orphaned after reload",
                  completed_at: new Date().toISOString(),
                });
              } catch {
                // Execution may not exist or already be updated
              }
            }
          }
        }
      } catch {
        // Backend unreachable on first mount — ignore
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);
}
