import { create } from "zustand";
import { STREAM_OUTPUT_MAX_LINES } from "../lib/constants";

/** Composite key for per-task, per-stage process tracking. */
export function stageKey(taskId: string, stageId: string): string {
  return `${taskId}:${stageId}`;
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

interface ProcessStore {
  stages: Record<string, StageProcessState>;
  mergeStages: Record<string, MergeStageState>;
  viewingStageId: string | null;
  pendingCommit: PendingCommit | null;
  committedStages: Record<string, string>; // stageId → short commit hash
  commitMessageLoadingStageId: string | null;
  commitGenerationNonce: number;
  noChangesStageId: string | null; // stage with no uncommitted changes to commit

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
  getMergeState: (key: string) => MergeStageState;
  updateMergeState: (key: string, patch: Partial<MergeStageState>) => void;
  clearMergeState: (key: string) => void;
}

function getStage(stages: Record<string, StageProcessState>, id: string): StageProcessState {
  return stages[id] ?? DEFAULT_STAGE_STATE;
}

export const useProcessStore = create<ProcessStore>((set, get) => ({
  stages: {},
  mergeStages: {},
  viewingStageId: null,
  pendingCommit: null,
  committedStages: {},
  commitMessageLoadingStageId: null,
  commitGenerationNonce: 0,
  noChangesStageId: null,

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
    })),

  setCommitMessageLoading: (stageId) => set({ commitMessageLoadingStageId: stageId }),

  setNoChangesToCommit: (stageId) => set({ noChangesStageId: stageId }),

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
}));
