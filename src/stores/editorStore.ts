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
  worktreeRoot: string | null;
  saveError: string | null;
  isSaving: boolean;
  unsavedChangesDialogOpen: boolean;
  fileAwaitingClosePath: string | null;
  unsavedChangesDialogCallback: ((confirm: boolean) => void) | null;

  toggleEditor: () => void;
  setWorktreeRoot: (root: string | null) => void;
  openFile: (path: string) => Promise<void>;
  closeFile: (path: string) => boolean;
  setActiveFile: (path: string) => void;
  updateFileContent: (path: string, content: string) => void;
  saveFile: (path: string) => Promise<void>;
  resetForTask: () => void;
  clearSaveError: () => void;
  promptUnsavedChanges: (filePath: string, callback: (confirm: boolean) => void) => void;
  resolveUnsavedChanges: (confirmed: boolean) => void;
}

export const useEditorStore = create<EditorStore>((set, get) => ({
  isEditorOpen: false,
  openFiles: [],
  activeFilePath: null,
  worktreeRoot: null,
  saveError: null,
  isSaving: false,
  unsavedChangesDialogOpen: false,
  fileAwaitingClosePath: null,
  unsavedChangesDialogCallback: null,

  toggleEditor: () => set((s) => ({ isEditorOpen: !s.isEditorOpen })),

  setWorktreeRoot: (root: string | null) => set({ worktreeRoot: root }),

  openFile: async (path: string) => {
    const { openFiles, worktreeRoot } = get();
    const existing = openFiles.find((f) => f.path === path);
    if (existing) {
      set({ activeFilePath: path });
      return;
    }

    if (!worktreeRoot) return;
    const content = await readFileContents(path, worktreeRoot);
    if (content === null) return;

    set((s) => ({
      openFiles: [...s.openFiles, { path, content, isDirty: false }],
      activeFilePath: path,
    }));
  },

  closeFile: (path: string) => {
    const { openFiles } = get();
    const file = openFiles.find((f) => f.path === path);
    if (file?.isDirty) {
      // Show custom dialog instead of window.confirm
      get().promptUnsavedChanges(path, (confirmed) => {
        if (confirmed) {
          get().resolveUnsavedChanges(true);
        }
      });
      return false; // Dialog will handle closing asynchronously
    }

    set((s) => {
      const filtered = s.openFiles.filter((f) => f.path !== path);
      let nextActive = s.activeFilePath;
      if (s.activeFilePath === path) {
        nextActive = filtered.length > 0 ? filtered[filtered.length - 1].path : null;
      }
      return { openFiles: filtered, activeFilePath: nextActive };
    });
    return true;
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
    const { openFiles, worktreeRoot } = get();
    const file = openFiles.find((f) => f.path === path);
    if (!file || !worktreeRoot) return;

    set({ isSaving: true });
    try {
      await writeFileContents(path, file.content, worktreeRoot);
      set((s) => ({
        saveError: null,
        isSaving: false,
        openFiles: s.openFiles.map((f) =>
          f.path === path ? { ...f, isDirty: false } : f,
        ),
      }));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      set({ saveError: message, isSaving: false });
    }
  },

  resetForTask: () => {
    set({
      openFiles: [],
      activeFilePath: null,
      saveError: null,
      isSaving: false,
      unsavedChangesDialogOpen: false,
      fileAwaitingClosePath: null,
      unsavedChangesDialogCallback: null,
    });
  },

  clearSaveError: () => set({ saveError: null }),

  promptUnsavedChanges: (filePath: string, callback: (confirm: boolean) => void) => {
    set({
      unsavedChangesDialogOpen: true,
      fileAwaitingClosePath: filePath,
      unsavedChangesDialogCallback: callback,
    });
  },

  resolveUnsavedChanges: (confirmed: boolean) => {
    const { fileAwaitingClosePath, unsavedChangesDialogCallback } = get();

    if (!fileAwaitingClosePath) return;

    if (confirmed) {
      if (unsavedChangesDialogCallback) {
        unsavedChangesDialogCallback(true);
      }

      // Only close the file when the user confirmed discarding changes
      set((s) => {
        const filtered = s.openFiles.filter((f) => f.path !== fileAwaitingClosePath);
        let nextActive = s.activeFilePath;
        if (s.activeFilePath === fileAwaitingClosePath) {
          nextActive = filtered.length > 0 ? filtered[filtered.length - 1].path : null;
        }
        return {
          openFiles: filtered,
          activeFilePath: nextActive,
          unsavedChangesDialogOpen: false,
          fileAwaitingClosePath: null,
          unsavedChangesDialogCallback: null,
        };
      });
    } else {
      // User chose "Keep Open" — just dismiss the dialog, keep the file open
      set({
        unsavedChangesDialogOpen: false,
        fileAwaitingClosePath: null,
        unsavedChangesDialogCallback: null,
      });
    }
  },
}));
