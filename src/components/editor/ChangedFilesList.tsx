import { useEffect, useState, useRef } from "react";
import { RefreshCw, Undo2, GitCommitHorizontal, Loader2 } from "lucide-react";
import { useEditorStore, type ChangedFile } from "../../stores/editorStore";
import { useProjectStore } from "../../stores/projectStore";
import { gitAdd, gitCommit, gitDiff, gitDiffFileStatsUnstaged, type DiffFileStat } from "../../lib/git";
import { getCommitPrefix, getProjectSetting } from "../../lib/repositories";
import { spawnAgent } from "../../lib/agent";
import { DiffFileList } from "../pipeline/DiffFileList";
import { Textarea } from "@/components/ui/textarea";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

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
  const resetFile = useEditorStore((s) => s.resetFile);
  const projectId = useProjectStore((s) => s.activeProject?.id);

  const [resetConfirmPath, setResetConfirmPath] = useState<string | null>(null);
  const [resetting, setResetting] = useState(false);
  const [resetError, setResetError] = useState<string | null>(null);

  // Commit dialog state
  const [commitDialogOpen, setCommitDialogOpen] = useState(false);
  const [commitMessage, setCommitMessage] = useState("");
  const [commitError, setCommitError] = useState<string | null>(null);
  const [committing, setCommitting] = useState(false);
  const [commitFileStats, setCommitFileStats] = useState<DiffFileStat[]>([]);
  const [loadingStats, setLoadingStats] = useState(false);
  const [generatingMsg, setGeneratingMsg] = useState(false);
  const intervalRef = useRef<ReturnType<typeof setInterval>>(undefined);

  // Load uncommitted file stats when dialog opens
  useEffect(() => {
    if (!commitDialogOpen || !workingDir) {
      clearInterval(intervalRef.current);
      return;
    }
    let cancelled = false;
    setLoadingStats(true);
    const load = () => {
      gitDiffFileStatsUnstaged(workingDir)
        .then((stats) => { if (!cancelled) { setCommitFileStats(stats); setLoadingStats(false); } })
        .catch(() => { if (!cancelled) setLoadingStats(false); });
    };
    load();
    intervalRef.current = setInterval(load, 5_000);
    return () => { cancelled = true; clearInterval(intervalRef.current); };
  }, [commitDialogOpen, workingDir]);

  const generateCommitMessage = async () => {
    if (!workingDir || !projectId) return;
    setGeneratingMsg(true);
    try {
      const diff = await gitDiff(workingDir);
      if (!diff.trim()) { setGeneratingMsg(false); return; }
      const prefix = await getCommitPrefix(projectId).catch(() => "feat");
      const agent = (await getProjectSetting(projectId, "default_agent")) ?? "claude";
      const truncatedDiff = diff.length > 8000 ? diff.slice(0, 8000) + "\n... (truncated)" : diff;
      const prompt = `Generate a short, one-line git commit message for this diff. Use the prefix "${prefix}:". Output ONLY the commit message, nothing else.\n\n${truncatedDiff}`;
      let resultText = "";
      await spawnAgent(
        {
          prompt,
          agent,
          workingDirectory: workingDir,
          noSessionPersistence: true,
          maxTurns: 1,
          allowedTools: [],
        },
        (event) => {
          if (event.type === "stdout_line") {
            try {
              const parsed = JSON.parse(event.line);
              // Claude format
              if (parsed.type === "assistant" && parsed.message?.content) {
                for (const block of parsed.message.content) {
                  if (block.type === "text") resultText += block.text;
                }
              } else if (parsed.type === "result") {
                const output = parsed.structured_output ?? parsed.result;
                if (output != null && output !== "") {
                  resultText = typeof output === "string" ? output : JSON.stringify(output);
                }
              }
              // Codex format
              else if (parsed.type === "item.completed" && parsed.item?.type === "agent_message" && parsed.item.text) {
                resultText = parsed.item.text;
              }
            } catch {
              // Not JSON — plain text output
              resultText += event.line;
            }
          }
          if (event.type === "completed") {
            const cleaned = resultText.replace(/\n/g, " ").trim();
            if (cleaned) setCommitMessage(cleaned);
            setGeneratingMsg(false);
          }
          if (event.type === "error") {
            setGeneratingMsg(false);
          }
        },
      );
    } catch {
      setGeneratingMsg(false);
    }
  };

  const handleOpenCommitDialog = async () => {
    setCommitError(null);
    setCommitMessage("");
    setCommitFileStats([]);
    setCommitDialogOpen(true);
    generateCommitMessage();
  };

  const handleCommit = async () => {
    if (!workingDir || !commitMessage.trim()) return;
    setCommitting(true);
    setCommitError(null);
    try {
      await gitAdd(workingDir);
      await gitCommit(workingDir, commitMessage);
      setCommitDialogOpen(false);
      setCommitMessage("");
      useEditorStore.getState().loadChangedFiles();
    } catch (err) {
      setCommitError(err instanceof Error ? err.message : String(err));
    } finally {
      setCommitting(false);
    }
  };

  const handleReset = async () => {
    if (!resetConfirmPath) return;
    setResetting(true);
    setResetError(null);
    try {
      await resetFile(resetConfirmPath);
      setResetConfirmPath(null);
    } catch (err) {
      setResetError(err instanceof Error ? err.message : String(err));
    } finally {
      setResetting(false);
    }
  };

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
        <div className="flex items-center gap-0.5">
          <button
            className="text-muted-foreground hover:text-foreground transition-colors p-0.5 rounded"
            onClick={handleOpenCommitDialog}
            title="Commit changes"
          >
            <GitCommitHorizontal className="w-3 h-3" />
          </button>
          <button
            className="text-muted-foreground hover:text-foreground transition-colors p-0.5 rounded"
            onClick={loadChangedFiles}
            title="Refresh"
          >
            <RefreshCw className="w-3 h-3" />
          </button>
        </div>
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
              <div
                key={relativePath}
                className={`group flex items-center w-full text-left py-[3px] px-2 gap-1.5 transition-colors ${
                  isActive
                    ? "bg-accent text-accent-foreground"
                    : "hover:bg-accent/40"
                }`}
              >
                <button
                  className="flex items-center gap-1.5 flex-1 min-w-0 text-left"
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
                <button
                  className="shrink-0 p-0.5 rounded opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive transition-all"
                  onClick={(e) => {
                    e.stopPropagation();
                    setResetConfirmPath(fullPath);
                    setResetError(null);
                  }}
                  title="Discard changes"
                >
                  <Undo2 className="w-3 h-3" />
                </button>
              </div>
            );
          })}
        </div>
      )}

      <Dialog open={!!resetConfirmPath} onOpenChange={(open) => { if (!open) setResetConfirmPath(null); }}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Discard Changes</DialogTitle>
            <DialogDescription>
              Reset <span className="font-mono text-foreground">{resetConfirmPath?.split("/").pop()}</span> to the target branch version? This cannot be undone.
            </DialogDescription>
          </DialogHeader>
          {resetError && (
            <Alert variant="destructive">
              <AlertDescription>{resetError}</AlertDescription>
            </Alert>
          )}
          <div className="flex justify-end gap-2">
            <Button variant="outline" size="sm" onClick={() => setResetConfirmPath(null)} disabled={resetting}>
              Cancel
            </Button>
            <Button variant="destructive" size="sm" onClick={handleReset} disabled={resetting}>
              {resetting ? "Discarding..." : "Discard"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Commit Dialog */}
      <Dialog open={commitDialogOpen} onOpenChange={setCommitDialogOpen}>
        <DialogContent className="sm:max-w-lg max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Commit Changes</DialogTitle>
            <DialogDescription>
              This shows uncommitted changes only. The Changes tab in the sidebar shows all changes (committed and uncommitted) compared to the target branch.
            </DialogDescription>
          </DialogHeader>

          {loadingStats ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground py-2">
              <Loader2 className="w-4 h-4 animate-spin" />
              Loading changes...
            </div>
          ) : commitFileStats.length === 0 ? (
            <div className="text-sm text-muted-foreground py-2">
              No uncommitted changes to commit.
            </div>
          ) : (
            <>
              <DiffFileList files={commitFileStats} />
              <div className="relative">
                <Textarea
                  value={commitMessage}
                  onChange={(e) => setCommitMessage(e.target.value)}
                  placeholder={generatingMsg ? "Generating commit message..." : "Commit message..."}
                  rows={1}
                  className="font-mono resize-none pr-8"
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                      e.preventDefault();
                      handleCommit();
                    }
                  }}
                />
                {generatingMsg && (
                  <Loader2 className="w-3.5 h-3.5 animate-spin absolute right-2.5 top-2.5 text-muted-foreground" />
                )}
              </div>

              {commitError && (
                <Alert variant="destructive">
                  <AlertDescription>{commitError}</AlertDescription>
                </Alert>
              )}

              <div className="flex justify-end">
                <Button
                  onClick={handleCommit}
                  disabled={committing || !commitMessage.trim()}
                  size="sm"
                >
                  {committing && <Loader2 className="w-4 h-4 animate-spin" />}
                  {committing ? "Committing..." : "Commit"}
                </Button>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
