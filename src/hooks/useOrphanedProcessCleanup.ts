import { useEffect } from "react";
import { listProcessesDetailed, killProcess } from "../lib/claude";
import { useProcessStore } from "../stores/processStore";

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

        for (const proc of processes) {
          if (!knownProcessIds.has(proc.processId)) {
            // Kill the orphaned backend process
            try {
              await killProcess(proc.processId);
            } catch {
              // May already be exiting
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
