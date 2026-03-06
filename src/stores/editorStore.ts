import { create } from "zustand";
import { readFileContents, writeFileContents, gitShowFile, gitDefaultBranch, gitStatus, gitResetFile, runGit } from "../lib/git";
import { useGitHubStore } from "./githubStore";
import { useTaskStore } from "./taskStore";
import { useProjectStore } from "./projectStore";
import { useNavigationStore } from "./navigationStore";

export interface OpenFile {
  /** Unique tab key: path for normal, "diff:"+path for diff view */
  key: string;
  path: string;
  content: string;
  /** Last known content read from disk (used to detect external changes) */
  diskContent: string;
  isDirty: boolean;
  isDiff: boolean;
  /** True when the file changed on disk while the user has unsaved edits */
  diskChanged: boolean;
}

export interface ChangedFile {
  path: string;
  status: "M" | "A" | "D" | "U";
}

function fileKey(path: string, isDiff: boolean): string {
  return isDiff ? `diff:${path}` : path;
}

/** Descriptor for a cached tab. Holds dirty content if the file had unsaved edits. */
interface TabDescriptor {
  path: string;
  isDiff: boolean;
  /** Non-null when the tab had unsaved edits at the time of caching */
  dirtyContent: string | null;
}

interface SavedTabState {
  tabs: TabDescriptor[];
  activeFileKey: string | null;
}

/** In-memory per-task tab cache. Survives task switches within a session. */
const tabCache: Record<string, SavedTabState> = {};

export type EditorSidebarView = "files" | "changes";

/** What to compare the working tree against in the Changes view. */
export type DiffBase = "merge-base" | "branch" | "head";

export const DIFF_BASE_LABELS: Record<DiffBase, string> = {
  "merge-base": "Branch point",
  "branch": "Target branch",
  "head": "Latest commit",
};

interface EditorStore {
  sidebarView: EditorSidebarView;
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
  diffBase: DiffBase;
  quickOpenVisible: boolean;
  /** Monotonic counter bumped on each resetForTask to invalidate in-flight async ops */
  _resetEpoch: number;
  /** Bumped when diffBase changes to invalidate in-flight originalContent fetches */
  _diffEpoch: number;
  /** Bumped when the file tree should refresh (e.g. after save) */
  _fileTreeEpoch: number;

  loadChangedFiles: () => Promise<void>;
  setDiffBase: (base: DiffBase) => void;
  setSidebarView: (view: EditorSidebarView) => void;
  fetchOriginalContent: (path: string) => Promise<void>;
  setQuickOpen: (open: boolean) => void;
  setWorktreeRoot: (root: string | null) => void;
  openFile: (path: string) => Promise<void>;
  openDiffFile: (path: string) => Promise<void>;
  closeFile: (key: string) => boolean;
  setActiveFile: (key: string) => void;
  updateFileContent: (key: string, content: string) => void;
  saveFile: (key: string) => Promise<void>;
  refreshOpenFiles: () => Promise<void>;
  reloadFileFromDisk: (key: string) => Promise<void>;
  dismissDiskChanged: (key: string) => void;
  resetForTask: () => void;
  saveTabsForTask: (taskId: string) => void;
  restoreTabsForTask: (taskId: string) => Promise<void>;
  clearSaveError: () => void;
  resetFile: (filePath: string) => Promise<void>;
  refreshDiffContent: () => void;
  promptUnsavedChanges: (fileKey: string, callback: (confirm: boolean) => void) => void;
  resolveUnsavedChanges: (confirmed: boolean) => void;

  /** Derived: path of the active file (for tree highlighting) */
  activeFilePath: () => string | null;
}

export const useEditorStore = create<EditorStore>((set, get) => ({
  sidebarView: "files" as EditorSidebarView,
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
  diffBase: "merge-base" as DiffBase,
  unsavedChangesDialogCallback: null,
  quickOpenVisible: false,
  _resetEpoch: 0,
  _diffEpoch: 0,
  _fileTreeEpoch: 0,

  activeFilePath: () => {
    const { activeFileKey, openFiles } = get();
    if (!activeFileKey) return null;
    const f = openFiles.find((f) => f.key === activeFileKey);
    return f?.path ?? null;
  },

  loadChangedFiles: async () => {
    const { worktreeRoot, diffBase, _resetEpoch: epoch } = get();
    if (!worktreeRoot) return;
    const target = useTaskStore.getState().activeTask?.target_branch
      ?? useGitHubStore.getState().defaultBranch
      ?? await gitDefaultBranch(worktreeRoot)
      ?? "main";
    const fileMap = new Map<string, ChangedFile["status"]>();

    try {
      let ref: string;
      if (diffBase === "head") {
        ref = "HEAD";
      } else if (diffBase === "branch") {
        ref = target;
      } else {
        // merge-base: where the branch diverged from target
        ref = (await runGit(worktreeRoot, "merge-base", target, "HEAD")).trim();
      }
      const raw = await runGit(worktreeRoot, "diff", "--name-status", ref);
      for (const line of raw.trim().split("\n")) {
        if (!line) continue;
        const parts = line.split("\t");
        if (parts.length < 2) continue;
        const code = parts[0][0];
        const filePath = parts.length >= 3 ? parts[2] : parts[1];
        if (code === "A") fileMap.set(filePath, "A");
        else if (code === "D") fileMap.set(filePath, "D");
        else fileMap.set(filePath, "M");
      }
    } catch {
      // No common ancestor or branch doesn't exist
    }
    // Overlay untracked / conflict status from git status
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
        if (xy === "??") {
          fileMap.set(filePath, "A");
        } else if (xy === "UU" || xy[0] === "U" || xy[1] === "U") {
          fileMap.set(filePath, "U");
        }
      }
    } catch {
      // ignore
    }
    const files: ChangedFile[] = [...fileMap.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([path, status]) => ({ path, status }));
    // Bail if a task switch happened while we were running git commands
    if (get()._resetEpoch !== epoch) return;
    set({ targetBranch: target, changedFiles: files });
  },

  fetchOriginalContent: async (path: string) => {
    const { worktreeRoot, originalContent, targetBranch, diffBase, _resetEpoch: epoch, _diffEpoch: diffEp } = get();
    if (!worktreeRoot) return;
    const relativePath = path.startsWith(worktreeRoot + "/")
      ? path.slice(worktreeRoot.length + 1)
      : path;
    if (originalContent[path] !== undefined) return;
    let ref: string;
    if (diffBase === "head") {
      ref = "HEAD";
    } else if (diffBase === "branch") {
      ref = targetBranch ?? "HEAD";
    } else {
      // merge-base
      try {
        ref = (await runGit(worktreeRoot, "merge-base", targetBranch ?? "main", "HEAD")).trim();
      } catch {
        ref = targetBranch ?? "HEAD";
      }
    }
    const content = await gitShowFile(worktreeRoot, relativePath, ref);
    if (get()._resetEpoch !== epoch || get()._diffEpoch !== diffEp) return;
    set((s) => ({ originalContent: { ...s.originalContent, [path]: content } }));
  },

  setDiffBase: (base: DiffBase) => {
    // Clear cached original content and bump epoch so in-flight fetches are discarded
    set((s) => ({ diffBase: base, originalContent: {}, _diffEpoch: s._diffEpoch + 1 }));
    get().loadChangedFiles();
    // Re-fetch original content for all open diff tabs with the new base
    const { openFiles } = get();
    for (const file of openFiles) {
      if (file.isDiff) {
        get().fetchOriginalContent(file.path);
      }
    }
    // Persist per-task
    const projectId = useProjectStore.getState().activeProject?.id;
    const taskId = useTaskStore.getState().activeTask?.id;
    if (projectId && taskId) {
      useNavigationStore.getState().persistTaskViewState(projectId, taskId, { diffBase: base });
    }
  },

  setSidebarView: (view) => set({ sidebarView: view }),
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
      openFiles: [...s.openFiles, { key, path, content, diskContent: content, isDirty: false, isDiff: false, diskChanged: false }],
      activeFileKey: key,
    }));
  },

  openDiffFile: async (path: string) => {
    const { openFiles, worktreeRoot, _resetEpoch: epoch } = get();
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

    if (get()._resetEpoch !== epoch) return;

    // Ensure target branch is resolved
    if (!get().targetBranch) {
      await get().loadChangedFiles();
    }
    await get().fetchOriginalContent(path);

    if (get()._resetEpoch !== epoch) return;

    set((s) => ({
      openFiles: [...s.openFiles, { key, path, content, diskContent: content, isDirty: false, isDiff: true, diskChanged: false }],
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
      openFiles: s.openFiles.map((f) => {
        if (f.key !== key) return f;
        // Compare against disk content to determine dirty state.
        // This prevents refreshes from marking files dirty, and also
        // correctly clears dirty if the user edits back to the disk version.
        const isDirty = content !== f.diskContent;
        return { ...f, content, isDirty };
      }),
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
        _fileTreeEpoch: s._fileTreeEpoch + 1,
        openFiles: s.openFiles.map((f) =>
          f.key === key ? { ...f, isDirty: false, diskContent: f.content, diskChanged: false } : f,
        ),
      }));
      // Refresh changed files list after save
      get().loadChangedFiles();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      set({ saveError: message, isSaving: false });
    }
  },

  refreshOpenFiles: async () => {
    const { openFiles, worktreeRoot } = get();
    if (!worktreeRoot || openFiles.length === 0) return;

    const updates: Array<{ key: string; newDiskContent: string }> = [];

    await Promise.all(
      openFiles.map(async (file) => {
        try {
          const currentDisk = await readFileContents(file.path, worktreeRoot);
          if (currentDisk !== null && currentDisk !== file.diskContent) {
            updates.push({ key: file.key, newDiskContent: currentDisk });
          }
        } catch {
          // File may have been deleted — ignore
        }
      }),
    );

    if (updates.length === 0) return;

    set((s) => ({
      openFiles: s.openFiles.map((f) => {
        const update = updates.find((u) => u.key === f.key);
        if (!update) return f;
        if (!f.isDirty) {
          // Not dirty: silently update content to match disk
          return { ...f, content: update.newDiskContent, diskContent: update.newDiskContent };
        } else {
          // Dirty: flag that disk changed, don't touch user's content
          return { ...f, diskContent: update.newDiskContent, diskChanged: true };
        }
      }),
    }));
  },

  reloadFileFromDisk: async (key: string) => {
    const { openFiles, worktreeRoot } = get();
    const file = openFiles.find((f) => f.key === key);
    if (!file || !worktreeRoot) return;

    try {
      const content = await readFileContents(file.path, worktreeRoot);
      if (content === null) return;
      set((s) => ({
        openFiles: s.openFiles.map((f) =>
          f.key === key
            ? { ...f, content, diskContent: content, isDirty: false, diskChanged: false }
            : f,
        ),
      }));
    } catch {
      // ignore
    }
  },

  dismissDiskChanged: (key: string) => {
    set((s) => ({
      openFiles: s.openFiles.map((f) =>
        f.key === key ? { ...f, diskChanged: false } : f,
      ),
    }));
  },

  resetForTask: () => {
    set((s) => ({
      _resetEpoch: s._resetEpoch + 1,
      _diffEpoch: s._diffEpoch + 1,
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
    }));
  },

  saveTabsForTask: (taskId) => {
    const { openFiles, activeFileKey } = get();
    if (openFiles.length === 0) {
      delete tabCache[taskId];
      return;
    }
    tabCache[taskId] = {
      tabs: openFiles.map((f) => ({
        path: f.path,
        isDiff: f.isDiff,
        dirtyContent: f.isDirty ? f.content : null,
      })),
      activeFileKey,
    };
  },

  restoreTabsForTask: async (taskId) => {
    const saved = tabCache[taskId];
    if (!saved || saved.tabs.length === 0) return;

    const { worktreeRoot, _resetEpoch: epoch } = get();
    if (!worktreeRoot) return;

    // Load current changed files so we can validate diff tabs
    await get().loadChangedFiles();
    if (get()._resetEpoch !== epoch) return;
    const { changedFiles } = get();
    const changedPaths = new Set(changedFiles.map((f) => f.path));

    // Re-open each tab by reading content from disk
    const opened: OpenFile[] = [];
    for (const tab of saved.tabs) {
      if (tab.isDiff) {
        // Skip diff tabs whose file is no longer in the changed list
        const relative = tab.path.startsWith(worktreeRoot + "/")
          ? tab.path.slice(worktreeRoot.length + 1)
          : tab.path;
        if (!changedPaths.has(relative)) continue;
      }

      let diskContent: string | null = null;
      try {
        diskContent = await readFileContents(tab.path, worktreeRoot);
      } catch {
        // File gone from disk — skip
      }
      if (diskContent === null && !tab.isDiff) continue;
      if (diskContent === null) diskContent = "";

      // If the tab had unsaved edits, restore them; otherwise use disk content
      const hasDirtyContent = tab.dirtyContent !== null;
      const content = hasDirtyContent ? tab.dirtyContent! : diskContent;

      opened.push({
        key: fileKey(tab.path, tab.isDiff),
        path: tab.path,
        content,
        diskContent,
        isDirty: hasDirtyContent && content !== diskContent,
        isDiff: tab.isDiff,
        diskChanged: false,
      });
    }

    if (opened.length === 0) return;
    if (get()._resetEpoch !== epoch) return;

    // Resolve active key: use saved if it still exists, else last tab
    const activeKey = opened.find((f) => f.key === saved.activeFileKey)
      ? saved.activeFileKey
      : opened[opened.length - 1].key;

    set({ openFiles: opened, activeFileKey: activeKey });

    // For diff tabs, ensure original content is fetched
    for (const file of opened) {
      if (file.isDiff) {
        get().fetchOriginalContent(file.path);
      }
    }
  },

  resetFile: async (filePath: string) => {
    const { worktreeRoot, targetBranch } = get();
    if (!worktreeRoot) return;
    const ref = targetBranch ?? "main";
    const relativePath = filePath.startsWith(worktreeRoot + "/")
      ? filePath.slice(worktreeRoot.length + 1)
      : filePath;
    await gitResetFile(worktreeRoot, relativePath, ref);
    // Close the diff tab if open
    const diffKey = `diff:${filePath}`;
    set((s) => {
      const filtered = s.openFiles.filter((f) => f.key !== diffKey);
      let nextActive = s.activeFileKey;
      if (s.activeFileKey === diffKey) {
        nextActive = filtered.length > 0 ? filtered[filtered.length - 1].key : null;
      }
      // Also clear original content cache for this path
      const { [filePath]: _, ...restOriginal } = s.originalContent;
      return { openFiles: filtered, activeFileKey: nextActive, originalContent: restOriginal, _fileTreeEpoch: s._fileTreeEpoch + 1 };
    });
    // Refresh changed files list
    get().loadChangedFiles();
  },

  refreshDiffContent: () => {
    set((s) => ({ originalContent: {}, _diffEpoch: s._diffEpoch + 1 }));
    const { openFiles } = get();
    for (const file of openFiles) {
      if (file.isDiff) {
        get().fetchOriginalContent(file.path);
      }
    }
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
