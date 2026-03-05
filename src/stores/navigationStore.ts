import { create } from "zustand";
import {
  getSetting,
  setSetting,
  getProjectSetting,
  setProjectSetting,
} from "../lib/repositories";
import { logger } from "../lib/logger";

export type EditorSidebarView = "files" | "changes";

export interface TaskViewState {
  stageId: string | null;
  activeView: "pipeline" | "editor" | "terminal";
  overview: boolean;
  editorSidebarView: EditorSidebarView;
  /** @deprecated kept for reading old persisted data */
  editor?: boolean;
  /** @deprecated kept for reading old persisted data */
  terminal?: boolean;
}

const DEFAULT_VIEW_STATE: TaskViewState = {
  stageId: null,
  activeView: "pipeline",
  overview: true,
  editorSidebarView: "files",
};

// Debounce timers keyed by a string identifier
const debounceTimers: Record<string, ReturnType<typeof setTimeout>> = {};

function debouncedWrite(key: string, fn: () => Promise<void>, ms = 150) {
  clearTimeout(debounceTimers[key]);
  debounceTimers[key] = setTimeout(() => {
    fn().catch((err) => logger.error(`nav persist [${key}]:`, err));
  }, ms);
}

interface NavigationStore {
  /** True once initial restoration is complete */
  restored: boolean;

  // --- Restore helpers (called during startup / navigation) ---
  getPersistedProjectId: () => Promise<string | null>;
  getPersistedTaskId: (projectId: string) => Promise<string | null>;
  getPersistedTaskViewState: (
    projectId: string,
    taskId: string,
  ) => Promise<TaskViewState>;

  // --- Persist helpers (called on user actions) ---
  persistActiveProject: (projectId: string) => void;
  persistActiveTask: (projectId: string, taskId: string | null) => void;
  persistTaskViewState: (
    projectId: string,
    taskId: string,
    patch: Partial<TaskViewState>,
  ) => void;

  setRestored: (v: boolean) => void;
}

// In-memory cache of task view states to avoid reading DB on every partial update
const viewStateCache: Record<string, TaskViewState> = {};

function viewStateCacheKey(projectId: string, taskId: string) {
  return `${projectId}:${taskId}`;
}

export const useNavigationStore = create<NavigationStore>((set) => ({
  restored: false,

  setRestored: (v) => set({ restored: v }),

  // --- Restore ---

  getPersistedProjectId: async () => {
    try {
      return await getSetting("nav:activeProjectId");
    } catch {
      return null;
    }
  },

  getPersistedTaskId: async (projectId) => {
    try {
      return await getProjectSetting(projectId, "nav:lastTaskId");
    } catch {
      return null;
    }
  },

  getPersistedTaskViewState: async (projectId, taskId) => {
    const ck = viewStateCacheKey(projectId, taskId);
    if (viewStateCache[ck]) return { ...viewStateCache[ck] };

    try {
      const raw = await getProjectSetting(
        projectId,
        `nav:task:${taskId}:viewState`,
      );
      if (raw) {
        const parsed = JSON.parse(raw) as Partial<TaskViewState>;
        // Migrate old editor/terminal booleans to activeView
        if (!parsed.activeView && (parsed.editor || parsed.terminal)) {
          parsed.activeView = parsed.terminal ? "terminal" : parsed.editor ? "editor" : "pipeline";
        }
        const state = { ...DEFAULT_VIEW_STATE, ...parsed };
        viewStateCache[ck] = state;
        return state;
      }
    } catch {
      // corrupt or missing — use defaults
    }
    return { ...DEFAULT_VIEW_STATE };
  },

  // --- Persist ---

  persistActiveProject: (projectId) => {
    debouncedWrite("activeProject", () =>
      setSetting("nav:activeProjectId", projectId),
    );
  },

  persistActiveTask: (projectId, taskId) => {
    if (taskId) {
      debouncedWrite(`lastTask:${projectId}`, () =>
        setProjectSetting(projectId, "nav:lastTaskId", taskId),
      );
    }
  },

  persistTaskViewState: (projectId, taskId, patch) => {
    const ck = viewStateCacheKey(projectId, taskId);
    const current = viewStateCache[ck] ?? { ...DEFAULT_VIEW_STATE };
    const updated = { ...current, ...patch };
    viewStateCache[ck] = updated;

    debouncedWrite(`viewState:${projectId}:${taskId}`, () =>
      setProjectSetting(
        projectId,
        `nav:task:${taskId}:viewState`,
        JSON.stringify(updated),
      ),
    );
  },
}));
