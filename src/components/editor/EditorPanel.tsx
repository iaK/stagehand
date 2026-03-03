import { useEffect, useRef } from "react";
import { useTaskStore } from "../../stores/taskStore";
import { useEditorStore } from "../../stores/editorStore";
import { FileTree } from "./FileTree";
import { CodeEditor } from "./CodeEditor";
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

  const unsavedChangesDialogOpen = useEditorStore((s) => s.unsavedChangesDialogOpen);
  const resolveUnsavedChanges = useEditorStore((s) => s.resolveUnsavedChanges);

  useEffect(() => {
    if (prevTaskIdRef.current !== taskId) {
      useEditorStore.getState().resetForTask();
      prevTaskIdRef.current = taskId;
    }
    useEditorStore.getState().setWorktreeRoot(worktreePath ?? null);
  }, [taskId, worktreePath]);

  if (!worktreePath) {
    return (
      <div className="flex-1 flex items-center justify-center text-muted-foreground text-sm">
        Run a pipeline stage first to create the worktree
      </div>
    );
  }

  return (
    <>
      <div className="flex-1 flex min-h-0">
        {/* File tree sidebar */}
        <div className="w-[200px] shrink-0 border-r border-border overflow-y-auto">
          <FileTree workingDir={worktreePath} />
        </div>

        {/* Editor */}
        <CodeEditor />
      </div>

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
