import { create } from "zustand";
import { STREAM_OUTPUT_MAX_LINES } from "../lib/constants";
import type { TaskStageInstance } from "../lib/types";

/** Composite key for per-task, per-stage process tracking. */
export function stageKey(taskId: string, stageId: string): string {
  return `${taskId}:${stageId}`;
}

export interface ActivePtySession {
  taskId: string;
  stageId: string;
  stage: TaskStageInstance;
}

export interface StageProcessState {
  streamOutput: string[];
  isRunning: boolean;
  processId: string | null;
  killed: boolean;
  lastOutputAt: number | null;
}

export const DEFAULT_STAGE_STATE: StageProcessState = {
  streamOutput: [],
  isRunning: false,
  processId: null,
  killed: false,
  lastOutputAt: null,
};

export interface PendingCommit {
  stageId: string;
  taskId: string;
  stageName: string;
  message: string;
  diffStat: string;
  fixId?: string;
}

export type MergeState = "loading" | "preview" | "merging" | "success" | "error" | "completed" | "fix_commit";

export interface MergeStageState {
  mergeState: MergeState;
  error: string | null;
  fixRunning: boolean;
  fixOutput: string;
  fixCommitMessage: string;
  fixCommitDiffStat: string;
}

export const DEFAULT_MERGE_STATE: MergeStageState = {
  mergeState: "loading",
  error: null,
  fixRunning: false,
  fixOutput: "",
  fixCommitMessage: "",
  fixCommitDiffStat: "",
};

export interface StageSuggestion {
  suggestedTemplateId: string | null;
  reason: string | null;
}

export interface TerminalTab {
  id: string;
  ptyId: string | null;
  status: "running" | "exited";
  agent: string; // "shell", "claude", "codex", etc.
}

interface ProcessStore {
  stages: Record<string, StageProcessState>;
  mergeStages: Record<string, MergeStageState>;
  activePtySessions: Record<string, ActivePtySession>;
  stageSuggestions: Record<string, StageSuggestion>; // task_stage_id → cached suggestion
  viewingStageId: string | null;
  pendingCommit: PendingCommit | null;
  committedStages: Record<string, string>; // stageId → short commit hash
  commitVersion: number; // increments on each commit to trigger UI refreshes
  commitMessageLoadingStageId: string | null;
  commitGenerationNonce: number;
  noChangesStageId: string | null; // stage with no uncommitted changes to commit
  activeView: "pipeline" | "editor" | "terminal";
  overviewOpen: boolean;
  terminalTabs: Record<string, TerminalTab>;         // tabId → tab
  terminalTabOrder: Record<string, string[]>;         // taskId → [tabId, ...]
  activeTerminalTabId: Record<string, string | null>; // taskId → active tabId

  appendOutput: (stageId: string, line: string) => void;
  clearOutput: (stageId: string) => void;
  setRunning: (stageId: string, processId: string) => void;
  setStopped: (stageId: string) => void;
  markKilled: (stageId: string) => void;
  setViewingStageId: (stageId: string | null) => void;
  setPendingCommit: (commit: PendingCommit) => void;
  clearPendingCommit: () => void;
  setCommitted: (stageId: string, shortHash: string) => void;
  setCommitMessageLoading: (stageId: string | null) => void;
  setNoChangesToCommit: (stageId: string | null) => void;
  setStageSuggestion: (taskStageId: string, suggestion: StageSuggestion) => void;
  getMergeState: (key: string) => MergeStageState;
  updateMergeState: (key: string, patch: Partial<MergeStageState>) => void;
  clearMergeState: (key: string) => void;
  registerPtySession: (key: string, taskId: string, stageId: string, stage: TaskStageInstance) => void;
  unregisterPtySession: (key: string) => void;
  setActiveView: (view: "pipeline" | "editor" | "terminal") => void;
  toggleOverview: () => void;
  setOverviewOpen: (open: boolean) => void;
  addTerminalTab: (taskId: string, agent: string) => string;
  removeTerminalTab: (taskId: string, tabId: string) => void;
  setActiveTerminalTab: (taskId: string, tabId: string) => void;
  updateTerminalTab: (tabId: string, patch: Partial<TerminalTab>) => void;
  getTerminalTabsForTask: (taskId: string) => TerminalTab[];
  getActiveTerminalTabId: (taskId: string) => string | null;
}

function getStage(stages: Record<string, StageProcessState>, id: string): StageProcessState {
  return stages[id] ?? DEFAULT_STAGE_STATE;
}

export const useProcessStore = create<ProcessStore>((set, get) => ({
  stages: {},
  mergeStages: {},
  activePtySessions: {},
  stageSuggestions: {},
  viewingStageId: null,
  pendingCommit: null,
  committedStages: {},
  commitVersion: 0,
  commitMessageLoadingStageId: null,
  commitGenerationNonce: 0,
  noChangesStageId: null,
  activeView: "pipeline" as "pipeline" | "editor" | "terminal",
  overviewOpen: true,
  terminalTabs: {},
  terminalTabOrder: {},
  activeTerminalTabId: {},

  appendOutput: (stageId, line) =>
    set((state) => {
      const stage = getStage(state.stages, stageId);
      const current = stage.streamOutput;
      const newOutput = current.length >= STREAM_OUTPUT_MAX_LINES
        ? [...current.slice(Math.floor(STREAM_OUTPUT_MAX_LINES / 2)), line]
        : [...current, line];
      return {
        stages: {
          ...state.stages,
          [stageId]: {
            ...stage,
            streamOutput: newOutput,
            lastOutputAt: Date.now(),
          },
        },
      };
    }),

  clearOutput: (stageId) =>
    set((state) => ({
      stages: {
        ...state.stages,
        [stageId]: {
          ...getStage(state.stages, stageId),
          streamOutput: [],
          killed: false, // Reset kill flag at the start of a new run
        },
      },
    })),

  setRunning: (stageId, processId) =>
    set((state) => {
      const current = getStage(state.stages, stageId);
      return {
        stages: {
          ...state.stages,
          [stageId]: {
            ...current,
            isRunning: true,
            processId,
            // Preserve killed flag — a kill requested during spawning should persist
            lastOutputAt: Date.now(),
          },
        },
      };
    }),

  setStopped: (stageId) =>
    set((state) => ({
      stages: {
        ...state.stages,
        [stageId]: {
          ...getStage(state.stages, stageId),
          isRunning: false,
          processId: null,
          lastOutputAt: null,
        },
      },
    })),

  markKilled: (stageId) =>
    set((state) => ({
      stages: {
        ...state.stages,
        [stageId]: {
          ...getStage(state.stages, stageId),
          killed: true,
        },
      },
    })),

  setViewingStageId: (stageId) => set({ viewingStageId: stageId }),

  setPendingCommit: (commit) => set({ pendingCommit: commit }),

  clearPendingCommit: () => set((state) => ({ pendingCommit: null, commitGenerationNonce: state.commitGenerationNonce + 1 })),

  setCommitted: (stageId, shortHash) =>
    set((state) => ({
      committedStages: {
        ...state.committedStages,
        [stageId]: shortHash,
      },
      commitVersion: state.commitVersion + 1,
    })),

  setCommitMessageLoading: (stageId) => set({ commitMessageLoadingStageId: stageId }),

  setNoChangesToCommit: (stageId) => set({ noChangesStageId: stageId }),

  setStageSuggestion: (taskStageId, suggestion) =>
    set((state) => ({
      stageSuggestions: { ...state.stageSuggestions, [taskStageId]: suggestion },
    })),

  getMergeState: (key) => get().mergeStages[key] ?? DEFAULT_MERGE_STATE,

  updateMergeState: (key, patch) =>
    set((state) => ({
      mergeStages: {
        ...state.mergeStages,
        [key]: { ...(state.mergeStages[key] ?? DEFAULT_MERGE_STATE), ...patch },
      },
    })),

  clearMergeState: (key) =>
    set((state) => {
      const { [key]: _, ...rest } = state.mergeStages;
      return { mergeStages: rest };
    }),

  registerPtySession: (key, taskId, stageId, stage) =>
    set((state) => ({
      activePtySessions: {
        ...state.activePtySessions,
        [key]: { taskId, stageId, stage },
      },
    })),

  unregisterPtySession: (key) =>
    set((state) => {
      const { [key]: _, ...rest } = state.activePtySessions;
      return { activePtySessions: rest };
    }),

  setActiveView: (view) => set({ activeView: view }),

  toggleOverview: () => set((state) => ({ overviewOpen: !state.overviewOpen })),

  setOverviewOpen: (open) => set({ overviewOpen: open }),

  addTerminalTab: (taskId, agent) => {
    const id = crypto.randomUUID();
    const tab: TerminalTab = { id, ptyId: null, status: "running", agent };
    set((state) => {
      const order = state.terminalTabOrder[taskId] ?? [];
      return {
        terminalTabs: { ...state.terminalTabs, [id]: tab },
        terminalTabOrder: { ...state.terminalTabOrder, [taskId]: [...order, id] },
        activeTerminalTabId: { ...state.activeTerminalTabId, [taskId]: id },
      };
    });
    return id;
  },

  removeTerminalTab: (taskId, tabId) =>
    set((state) => {
      const { [tabId]: _, ...restTabs } = state.terminalTabs;
      const order = (state.terminalTabOrder[taskId] ?? []).filter((id) => id !== tabId);
      const activeId = state.activeTerminalTabId[taskId];
      let newActive: string | null = activeId === tabId
        ? (order[order.length - 1] ?? null)
        : activeId ?? null;
      return {
        terminalTabs: restTabs,
        terminalTabOrder: { ...state.terminalTabOrder, [taskId]: order },
        activeTerminalTabId: { ...state.activeTerminalTabId, [taskId]: newActive },
      };
    }),

  setActiveTerminalTab: (taskId, tabId) =>
    set((state) => ({
      activeTerminalTabId: { ...state.activeTerminalTabId, [taskId]: tabId },
    })),

  updateTerminalTab: (tabId, patch) =>
    set((state) => {
      const existing = state.terminalTabs[tabId];
      if (!existing) return {};
      return {
        terminalTabs: { ...state.terminalTabs, [tabId]: { ...existing, ...patch } },
      };
    }),

  getTerminalTabsForTask: (taskId) => {
    const state = get();
    const order = state.terminalTabOrder[taskId] ?? [];
    return order.map((id) => state.terminalTabs[id]).filter(Boolean);
  },

  getActiveTerminalTabId: (taskId) => get().activeTerminalTabId[taskId] ?? null,
}));
