import { create } from "zustand";

interface ProcessStore {
  streamOutput: string[];
  isRunning: boolean;
  currentProcessId: string | null;
  killed: boolean;

  appendOutput: (line: string) => void;
  clearOutput: () => void;
  setRunning: (processId: string) => void;
  setStopped: () => void;
  markKilled: () => void;
}

export const useProcessStore = create<ProcessStore>((set) => ({
  streamOutput: [],
  isRunning: false,
  currentProcessId: null,
  killed: false,

  appendOutput: (line) =>
    set((state) => ({
      streamOutput: [...state.streamOutput, line],
    })),

  clearOutput: () => set({ streamOutput: [] }),

  setRunning: (processId) =>
    set({ isRunning: true, currentProcessId: processId, killed: false }),

  setStopped: () =>
    set({ isRunning: false, currentProcessId: null }),

  markKilled: () => set({ killed: true }),
}));
