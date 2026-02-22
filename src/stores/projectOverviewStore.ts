import { create } from "zustand";
import type { Task, TokenTotals } from "../lib/types";
import * as repo from "../lib/repositories";
import { useProjectStore } from "./projectStore";

interface ProjectOverviewStore {
  archivedTasks: Task[];
  tokenUsage: TokenTotals | null;
  tokenUsageToday: TokenTotals | null;
  loading: boolean;
  error: string | null;

  loadProjectOverview: (projectId: string) => Promise<void>;
  clear: () => void;
}

export const useProjectOverviewStore = create<ProjectOverviewStore>((set) => ({
  archivedTasks: [],
  tokenUsage: null,
  tokenUsageToday: null,
  loading: false,
  error: null,

  loadProjectOverview: async (projectId) => {
    set({ loading: true, error: null, archivedTasks: [], tokenUsage: null, tokenUsageToday: null });

    try {
      // Compute today's midnight in local timezone, converted to ISO UTC
      const now = new Date();
      const todayMidnight = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      const todayMidnightIso = todayMidnight.toISOString();

      const [archivedTasks, tokenUsage, tokenUsageToday] = await Promise.all([
        repo.listArchivedTasks(projectId),
        repo.getProjectTokenUsage(projectId),
        repo.getProjectTokenUsageSince(projectId, todayMidnightIso),
      ]);

      // Guard against stale responses
      if (useProjectStore.getState().activeProject?.id !== projectId) return;

      set({ archivedTasks, tokenUsage, tokenUsageToday, loading: false });
    } catch (err) {
      set({ loading: false, error: err instanceof Error ? err.message : "Failed to load project overview" });
    }
  },

  clear: () => set({ archivedTasks: [], tokenUsage: null, tokenUsageToday: null, loading: false, error: null }),
}));
