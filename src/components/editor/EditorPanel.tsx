import { useTaskStore } from "../../stores/taskStore";
import { FileTree } from "./FileTree";
import { CodeEditor } from "./CodeEditor";

export function EditorPanel() {
  const activeTask = useTaskStore((s) => s.activeTask);
  const worktreePath = activeTask?.worktree_path;

  if (!worktreePath) {
    return (
      <div className="flex-1 flex items-center justify-center text-muted-foreground text-sm">
        Run a pipeline stage first to create the worktree
      </div>
    );
  }

  return (
    <div className="flex-1 flex min-h-0">
      {/* File tree sidebar */}
      <div className="w-[200px] shrink-0 border-r border-border overflow-y-auto">
        <FileTree workingDir={worktreePath} />
      </div>

      {/* Editor */}
      <CodeEditor />
    </div>
  );
}
