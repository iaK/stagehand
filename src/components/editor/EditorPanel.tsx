import { useState, useEffect, useRef } from "react";
import { useTaskStore } from "../../stores/taskStore";
import { useEditorStore } from "../../stores/editorStore";
import { FileTree } from "./FileTree";
import { ChangedFilesList } from "./ChangedFilesList";
import { CodeEditor } from "./CodeEditor";
import { FilePalette } from "./FilePalette";
import { useSettingsStore } from "@/stores/settingsStore";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogCancel,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";

export function EditorPanel() {
  const activeTask = useTaskStore((s) => s.activeTask);
  const worktreePath = activeTask?.worktree_path;
  const taskId = activeTask?.id;
  const prevTaskIdRef = useRef(taskId);

  const [sidebarView, setSidebarView] = useState<"files" | "changes">("files");
  const editorSidebarPosition = useSettingsStore((s) => s.editorSidebarPosition);
  const editorFontSize = useSettingsStore((s) => s.editorFontSize);
  const unsavedChangesDialogOpen = useEditorStore((s) => s.unsavedChangesDialogOpen);
  const resolveUnsavedChanges = useEditorStore((s) => s.resolveUnsavedChanges);

  useEffect(() => {
    if (prevTaskIdRef.current !== taskId) {
      useEditorStore.getState().resetForTask();
      prevTaskIdRef.current = taskId;
    }
    useEditorStore.getState().setWorktreeRoot(worktreePath ?? null);
  }, [taskId, worktreePath]);

  // Poll for git changes every 10s while the editor is open
  useEffect(() => {
    if (!worktreePath) return;
    const id = setInterval(() => {
      useEditorStore.getState().loadChangedFiles();
    }, 10_000);
    return () => clearInterval(id);
  }, [worktreePath]);

  // Cmd+P / Ctrl+P to open quick file search
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "p") {
        e.preventDefault();
        useEditorStore.getState().setQuickOpen(true);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  if (!worktreePath) {
    return (
      <div className="flex-1 flex items-center justify-center text-muted-foreground text-sm">
        Run a pipeline stage first to create the worktree
      </div>
    );
  }

  return (
    <>
      <div className={`flex-1 flex min-h-0 ${editorSidebarPosition === "right" ? "flex-row-reverse" : ""}`}>
        {/* Sidebar */}
        <div className={`w-[200px] shrink-0 flex flex-col ${editorSidebarPosition === "right" ? "border-l border-border" : "border-r border-border"}`} style={{ fontSize: `${editorFontSize}px` }}>
          <div className="flex items-center shrink-0 border-b border-border bg-muted/30">
            <button
              className={`flex-1 px-3 py-1.5 text-center transition-colors border-b-2 -mb-px ${
                sidebarView === "files"
                  ? "text-foreground border-foreground font-medium"
                  : "text-muted-foreground hover:text-foreground border-transparent"
              }`}
              onClick={() => setSidebarView("files")}
            >
              Explorer
            </button>
            <button
              className={`flex-1 px-3 py-1.5 text-center transition-colors border-b-2 -mb-px ${
                sidebarView === "changes"
                  ? "text-foreground border-foreground font-medium"
                  : "text-muted-foreground hover:text-foreground border-transparent"
              }`}
              onClick={() => setSidebarView("changes")}
            >
              Changes
            </button>
          </div>
          <div className="flex-1 overflow-y-auto">
            {sidebarView === "changes" ? (
              <ChangedFilesList workingDir={worktreePath} />
            ) : (
              <FileTree workingDir={worktreePath} />
            )}
          </div>
        </div>

        {/* Editor */}
        <CodeEditor />
      </div>

      <FilePalette />

      {/* Unsaved Changes Dialog */}
      <AlertDialog open={unsavedChangesDialogOpen} onOpenChange={() => {}}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Unsaved Changes</AlertDialogTitle>
            <AlertDialogDescription>
              This file has unsaved changes. Close without saving?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => resolveUnsavedChanges(false)}>
              Keep Open
            </AlertDialogCancel>
            <Button variant="destructive" onClick={() => resolveUnsavedChanges(true)}>
              Close Without Saving
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
