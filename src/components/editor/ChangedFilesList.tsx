import { useEffect } from "react";
import { RefreshCw } from "lucide-react";
import { useEditorStore, type ChangedFile } from "../../stores/editorStore";

const STATUS_STYLE: Record<ChangedFile["status"], { color: string; bg: string }> = {
  M: { color: "text-yellow-700 dark:text-yellow-300", bg: "bg-yellow-100 dark:bg-yellow-500/20" },
  A: { color: "text-green-700 dark:text-green-300", bg: "bg-green-100 dark:bg-green-500/20" },
  D: { color: "text-red-700 dark:text-red-300", bg: "bg-red-100 dark:bg-red-500/20" },
  U: { color: "text-orange-700 dark:text-orange-300", bg: "bg-orange-100 dark:bg-orange-500/20" },
};

interface ChangedFilesListProps {
  workingDir: string;
}

export function ChangedFilesList({ workingDir }: ChangedFilesListProps) {
  const changedFiles = useEditorStore((s) => s.changedFiles);
  const targetBranch = useEditorStore((s) => s.targetBranch);
  const activeFileKey = useEditorStore((s) => s.activeFileKey);
  const openDiffFile = useEditorStore((s) => s.openDiffFile);
  const loadChangedFiles = useEditorStore((s) => s.loadChangedFiles);

  // Initial load (polling handled by EditorPanel)
  useEffect(() => {
    if (changedFiles.length === 0) {
      loadChangedFiles();
    }
  }, [workingDir, changedFiles.length, loadChangedFiles]);

  return (
    <div className="flex flex-col h-full select-none text-xs">
      {/* Header */}
      <div className="flex items-center justify-between px-2 py-1.5 shrink-0 border-b border-border">
        <span className="text-[11px] font-medium text-foreground/70">
          Changes
          {changedFiles.length > 0 && (
            <span className="ml-1.5 text-muted-foreground font-normal">
              ({changedFiles.length})
            </span>
          )}
        </span>
        <button
          className="text-muted-foreground hover:text-foreground transition-colors p-0.5 rounded"
          onClick={loadChangedFiles}
          title="Refresh"
        >
          <RefreshCw className="w-3 h-3" />
        </button>
      </div>

      {changedFiles.length === 0 ? (
        <div className="p-3 text-muted-foreground text-center text-[11px]">
          No changes vs {targetBranch ?? "main"}
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto py-0.5">
          {changedFiles.map(({ path: relativePath, status }) => {
            const fullPath = `${workingDir}/${relativePath}`;
            const diffKey = `diff:${fullPath}`;
            const isActive = activeFileKey === diffKey;
            const fileName = relativePath.split("/").pop() ?? relativePath;
            const dirPath = relativePath.includes("/")
              ? relativePath.slice(0, relativePath.lastIndexOf("/"))
              : null;
            const st = STATUS_STYLE[status] ?? STATUS_STYLE.M;

            return (
              <button
                key={relativePath}
                className={`flex items-center w-full text-left py-[3px] px-2 gap-1.5 transition-colors ${
                  isActive
                    ? "bg-accent text-accent-foreground"
                    : "hover:bg-accent/40"
                }`}
                onClick={() => openDiffFile(fullPath)}
              >
                <span className={`shrink-0 w-4 text-center text-[10px] font-semibold rounded px-0.5 ${st.color} ${st.bg}`}>
                  {status}
                </span>
                <span className="truncate flex-1 text-[12px]">
                  {fileName}
                  {dirPath && (
                    <span className="text-muted-foreground ml-1.5 text-[11px]">{dirPath}</span>
                  )}
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
