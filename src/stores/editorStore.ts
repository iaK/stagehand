import { create } from "zustand";
import { readFileContents, writeFileContents, gitShowFile, gitDefaultBranch, gitDiffNameOnly, gitStatus } from "../lib/git";

export interface OpenFile {
  /** Unique tab key: path for normal, "diff:"+path for diff view */
  key: string;
  path: string;
  content: string;
  isDirty: boolean;
  isDiff: boolean;
}

export interface ChangedFile {
  path: string;
  status: "M" | "A" | "D" | "U";
}

function fileKey(path: string, isDiff: boolean): string {
  return isDiff ? `diff:${path}` : path;
}

interface EditorStore {
  isEditorOpen: boolean;
  openFiles: OpenFile[];
  /** Key of the active tab (path or "diff:"+path) */
  activeFileKey: string | null;
  worktreeRoot: string | null;
  saveError: string | null;
  isSaving: boolean;
  unsavedChangesDialogOpen: boolean;
  fileAwaitingCloseKey: string | null;
  unsavedChangesDialogCallback: ((confirm: boolean) => void) | null;
  originalContent: Record<string, string>;
  changedFiles: ChangedFile[];
  targetBranch: string | null;
  quickOpenVisible: boolean;

  loadChangedFiles: () => Promise<void>;
  fetchOriginalContent: (path: string) => Promise<void>;
  toggleEditor: () => void;
  setQuickOpen: (open: boolean) => void;
  setWorktreeRoot: (root: string | null) => void;
  openFile: (path: string) => Promise<void>;
  openDiffFile: (path: string) => Promise<void>;
  closeFile: (key: string) => boolean;
  setActiveFile: (key: string) => void;
  updateFileContent: (key: string, content: string) => void;
  saveFile: (key: string) => Promise<void>;
  resetForTask: () => void;
  clearSaveError: () => void;
  promptUnsavedChanges: (fileKey: string, callback: (confirm: boolean) => void) => void;
  resolveUnsavedChanges: (confirmed: boolean) => void;

  /** Derived: path of the active file (for tree highlighting) */
  activeFilePath: () => string | null;
}

export const useEditorStore = create<EditorStore>((set, get) => ({
  isEditorOpen: false,
  openFiles: [],
  activeFileKey: null,
  worktreeRoot: null,
  saveError: null,
  isSaving: false,
  unsavedChangesDialogOpen: false,
  fileAwaitingCloseKey: null,
  originalContent: {},
  changedFiles: [],
  targetBranch: null,
  unsavedChangesDialogCallback: null,
  quickOpenVisible: false,

  activeFilePath: () => {
    const { activeFileKey, openFiles } = get();
    if (!activeFileKey) return null;
    const f = openFiles.find((f) => f.key === activeFileKey);
    return f?.path ?? null;
  },

  loadChangedFiles: async () => {
    const { worktreeRoot } = get();
    if (!worktreeRoot) return;
    const target = await gitDefaultBranch(worktreeRoot) ?? "main";
    const fileMap = new Map<string, ChangedFile["status"]>();
    try {
      for (const f of await gitDiffNameOnly(worktreeRoot, target)) {
        fileMap.set(f, "M");
      }
    } catch {
      // No common ancestor or branch doesn't exist
    }
    try {
      const raw = await gitStatus(worktreeRoot);
      for (let line of raw.trim().split("\n")) {
        if (!line) continue;
        if (line.length >= 2 && line[1] === " " && line[0] !== "?" && !line.startsWith("  ")) {
          line = " " + line;
        }
        if (line.length < 4) continue;
        const xy = line.slice(0, 2);
        const filePath = line.slice(3).trim();
        if (!filePath) continue;
        if (xy === "??" || xy[0] === "A" || xy[1] === "A") {
          fileMap.set(filePath, "A");
        } else if (xy[0] === "D" || xy[1] === "D") {
          fileMap.set(filePath, "D");
        } else if (xy === "UU" || xy[0] === "U" || xy[1] === "U") {
          fileMap.set(filePath, "U");
        } else if (!fileMap.has(filePath)) {
          fileMap.set(filePath, "M");
        }
      }
    } catch {
      // ignore
    }
    const files: ChangedFile[] = [...fileMap.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([path, status]) => ({ path, status }));
    set({ targetBranch: target, changedFiles: files });
  },

  fetchOriginalContent: async (path: string) => {
    const { worktreeRoot, originalContent, targetBranch } = get();
    if (!worktreeRoot) return;
    const relativePath = path.startsWith(worktreeRoot + "/")
      ? path.slice(worktreeRoot.length + 1)
      : path;
    if (originalContent[path] !== undefined) return;
    const ref = targetBranch ?? "HEAD";
    const content = await gitShowFile(worktreeRoot, relativePath, ref);
    set((s) => ({ originalContent: { ...s.originalContent, [path]: content } }));
  },

  toggleEditor: () => set((s) => ({ isEditorOpen: !s.isEditorOpen })),
  setQuickOpen: (open: boolean) => set({ quickOpenVisible: open }),

  setWorktreeRoot: (root: string | null) => set({ worktreeRoot: root }),

  openFile: async (path: string) => {
    const { openFiles, worktreeRoot } = get();
    const key = fileKey(path, false);
    const existing = openFiles.find((f) => f.key === key);
    if (existing) {
      set({ activeFileKey: key });
      return;
    }

    if (!worktreeRoot) return;
    let content: string | null = null;
    try {
      content = await readFileContents(path, worktreeRoot);
    } catch {
      // File may not be readable
    }
    if (content === null) return;

    set((s) => ({
      openFiles: [...s.openFiles, { key, path, content, isDirty: false, isDiff: false }],
      activeFileKey: key,
    }));
  },

  openDiffFile: async (path: string) => {
    const { openFiles, worktreeRoot } = get();
    const key = fileKey(path, true);
    const existing = openFiles.find((f) => f.key === key);
    if (existing) {
      set({ activeFileKey: key });
      return;
    }

    if (!worktreeRoot) return;
    let content: string | null = null;
    try {
      content = await readFileContents(path, worktreeRoot);
    } catch {
      // Deleted files won't exist on disk
    }
    if (content === null) content = "";

    // Ensure target branch is resolved
    if (!get().targetBranch) {
      await get().loadChangedFiles();
    }
    await get().fetchOriginalContent(path);

    set((s) => ({
      openFiles: [...s.openFiles, { key, path, content, isDirty: false, isDiff: true }],
      activeFileKey: key,
    }));
  },

  closeFile: (key: string) => {
    const { openFiles } = get();
    const file = openFiles.find((f) => f.key === key);
    if (file?.isDirty) {
      get().promptUnsavedChanges(key, (confirmed) => {
        if (confirmed) {
          get().resolveUnsavedChanges(true);
        }
      });
      return false;
    }

    set((s) => {
      const filtered = s.openFiles.filter((f) => f.key !== key);
      let nextActive = s.activeFileKey;
      if (s.activeFileKey === key) {
        nextActive = filtered.length > 0 ? filtered[filtered.length - 1].key : null;
      }
      return { openFiles: filtered, activeFileKey: nextActive };
    });
    return true;
  },

  setActiveFile: (key: string) => set({ activeFileKey: key }),

  updateFileContent: (key: string, content: string) => {
    set((s) => ({
      openFiles: s.openFiles.map((f) =>
        f.key === key ? { ...f, content, isDirty: true } : f,
      ),
    }));
  },

  saveFile: async (key: string) => {
    const { openFiles, worktreeRoot } = get();
    const file = openFiles.find((f) => f.key === key);
    if (!file || !worktreeRoot) return;

    set({ isSaving: true });
    try {
      await writeFileContents(file.path, file.content, worktreeRoot);
      set((s) => ({
        saveError: null,
        isSaving: false,
        openFiles: s.openFiles.map((f) =>
          f.key === key ? { ...f, isDirty: false } : f,
        ),
      }));
      // Refresh changed files list after save
      get().loadChangedFiles();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      set({ saveError: message, isSaving: false });
    }
  },

  resetForTask: () => {
    set({
      openFiles: [],
      activeFileKey: null,
      saveError: null,
      isSaving: false,
      originalContent: {},
      changedFiles: [],
      targetBranch: null,
      unsavedChangesDialogOpen: false,
      fileAwaitingCloseKey: null,
      unsavedChangesDialogCallback: null,
      quickOpenVisible: false,
    });
  },

  clearSaveError: () => set({ saveError: null }),

  promptUnsavedChanges: (fk: string, callback: (confirm: boolean) => void) => {
    set({
      unsavedChangesDialogOpen: true,
      fileAwaitingCloseKey: fk,
      unsavedChangesDialogCallback: callback,
    });
  },

  resolveUnsavedChanges: (confirmed: boolean) => {
    const { fileAwaitingCloseKey, unsavedChangesDialogCallback } = get();

    if (!fileAwaitingCloseKey) return;

    if (confirmed) {
      if (unsavedChangesDialogCallback) {
        unsavedChangesDialogCallback(true);
      }

      set((s) => {
        const filtered = s.openFiles.filter((f) => f.key !== fileAwaitingCloseKey);
        let nextActive = s.activeFileKey;
        if (s.activeFileKey === fileAwaitingCloseKey) {
          nextActive = filtered.length > 0 ? filtered[filtered.length - 1].key : null;
        }
        return {
          openFiles: filtered,
          activeFileKey: nextActive,
          unsavedChangesDialogOpen: false,
          fileAwaitingCloseKey: null,
          unsavedChangesDialogCallback: null,
        };
      });
    } else {
      set({
        unsavedChangesDialogOpen: false,
        fileAwaitingCloseKey: null,
        unsavedChangesDialogCallback: null,
      });
    }
  },
}));
