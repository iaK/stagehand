import { create } from "zustand";
import { readFileContents, writeFileContents } from "../lib/git";

interface OpenFile {
  path: string;
  content: string;
  isDirty: boolean;
}

interface EditorStore {
  isEditorOpen: boolean;
  openFiles: OpenFile[];
  activeFilePath: string | null;

  toggleEditor: () => void;
  openFile: (path: string) => Promise<void>;
  closeFile: (path: string) => void;
  setActiveFile: (path: string) => void;
  updateFileContent: (path: string, content: string) => void;
  saveFile: (path: string) => Promise<void>;
}

export const useEditorStore = create<EditorStore>((set, get) => ({
  isEditorOpen: false,
  openFiles: [],
  activeFilePath: null,

  toggleEditor: () => set((s) => ({ isEditorOpen: !s.isEditorOpen })),

  openFile: async (path: string) => {
    const { openFiles } = get();
    const existing = openFiles.find((f) => f.path === path);
    if (existing) {
      set({ activeFilePath: path });
      return;
    }

    const content = await readFileContents(path);
    if (content === null) return;

    set((s) => ({
      openFiles: [...s.openFiles, { path, content, isDirty: false }],
      activeFilePath: path,
    }));
  },

  closeFile: (path: string) => {
    set((s) => {
      const filtered = s.openFiles.filter((f) => f.path !== path);
      let nextActive = s.activeFilePath;
      if (s.activeFilePath === path) {
        nextActive = filtered.length > 0 ? filtered[filtered.length - 1].path : null;
      }
      return { openFiles: filtered, activeFilePath: nextActive };
    });
  },

  setActiveFile: (path: string) => set({ activeFilePath: path }),

  updateFileContent: (path: string, content: string) => {
    set((s) => ({
      openFiles: s.openFiles.map((f) =>
        f.path === path ? { ...f, content, isDirty: true } : f,
      ),
    }));
  },

  saveFile: async (path: string) => {
    const file = get().openFiles.find((f) => f.path === path);
    if (!file) return;
    await writeFileContents(path, file.content);
    set((s) => ({
      openFiles: s.openFiles.map((f) =>
        f.path === path ? { ...f, isDirty: false } : f,
      ),
    }));
  },
}));
