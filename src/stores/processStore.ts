import { create } from "zustand";

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
  stageName: string;
  message: string;
  diffStat: string;
}

interface ProcessStore {
  stages: Record<string, StageProcessState>;
  viewingStageId: string | null;
  pendingCommit: PendingCommit | null;
  committedStages: Record<string, string>; // stageId → short commit hash

  appendOutput: (stageId: string, line: string) => void;
  clearOutput: (stageId: string) => void;
  setRunning: (stageId: string, processId: string) => void;
  setStopped: (stageId: string) => void;
  markKilled: (stageId: string) => void;
  setViewingStageId: (stageId: string | null) => void;
  setPendingCommit: (commit: PendingCommit) => void;
  clearPendingCommit: () => void;
  setCommitted: (stageId: string, shortHash: string) => void;
}

function getStage(stages: Record<string, StageProcessState>, id: string): StageProcessState {
  return stages[id] ?? DEFAULT_STAGE_STATE;
}

export const useProcessStore = create<ProcessStore>((set) => ({
  stages: {},
  viewingStageId: null,
  pendingCommit: null,
  committedStages: {},

  appendOutput: (stageId, line) =>
    set((state) => {
      const stage = getStage(state.stages, stageId);
      return {
        stages: {
          ...state.stages,
          [stageId]: {
            ...stage,
            streamOutput: [...stage.streamOutput, line],
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
        },
      },
    })),

  setRunning: (stageId, processId) =>
    set((state) => ({
      stages: {
        ...state.stages,
        [stageId]: {
          ...getStage(state.stages, stageId),
          isRunning: true,
          processId,
          killed: false,
          lastOutputAt: Date.now(),
        },
      },
    })),

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

  clearPendingCommit: () => set({ pendingCommit: null }),

  setCommitted: (stageId, shortHash) =>
    set((state) => ({
      committedStages: {
        ...state.committedStages,
        [stageId]: shortHash,
      },
    })),
}));
