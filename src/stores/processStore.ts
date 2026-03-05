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

export interface TerminalSession {
  ptyId: string | null;
  status: "idle" | "running" | "exited";
  agent: string | null;
}

export const DEFAULT_TERMINAL_SESSION: TerminalSession = {
  ptyId: null,
  status: "idle",
  agent: null,
};

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
  terminalOpen: boolean;
  terminalSessions: Record<string, TerminalSession>; // keyed by taskId

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
  toggleTerminal: () => void;
  setTerminalOpen: (open: boolean) => void;
  getTerminalSession: (taskId: string) => TerminalSession;
  updateTerminalSession: (taskId: string, patch: Partial<TerminalSession>) => void;
  removeTerminalSession: (taskId: string) => void;
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
  terminalOpen: false,
  terminalSessions: {},

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

  toggleTerminal: () => set((state) => ({ terminalOpen: !state.terminalOpen })),

  setTerminalOpen: (open) => set({ terminalOpen: open }),

  getTerminalSession: (taskId) => get().terminalSessions[taskId] ?? DEFAULT_TERMINAL_SESSION,

  updateTerminalSession: (taskId, patch) =>
    set((state) => ({
      terminalSessions: {
        ...state.terminalSessions,
        [taskId]: { ...(state.terminalSessions[taskId] ?? DEFAULT_TERMINAL_SESSION), ...patch },
      },
    })),

  removeTerminalSession: (taskId) =>
    set((state) => {
      const { [taskId]: _, ...rest } = state.terminalSessions;
      return { terminalSessions: rest };
    }),
}));
