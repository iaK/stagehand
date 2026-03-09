import { useState, useEffect, useCallback } from "react";
import { useTaskStore } from "../../stores/taskStore";
import { useProjectStore } from "../../stores/projectStore";
import { useGitHubStore } from "../../stores/githubStore";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { sendNotification } from "../../lib/notifications";
import { gitListBranches, gitBranchExists, gitWorktreeAdd, gitWorktreeRemove, ghFindPrForBranch, isGitRepo, gitCurrentBranch, gitCheckoutBranch } from "../../lib/git";
import * as repo from "../../lib/repositories";
import type { Task } from "../../lib/types";

type Mode = "new" | "import";

interface TaskCreateProps {
  projectId: string;
  onClose: () => void;
  task?: Task;
}

export function TaskCreate({ projectId, onClose, task }: TaskCreateProps) {
  const [title, setTitle] = useState(task?.title ?? "");
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<Mode>("new");

  // Import mode state
  const [branchName, setBranchName] = useState("");
  const [branchFilter, setBranchFilter] = useState("");
  const [allBranches, setAllBranches] = useState<string[]>([]);
  const [loadingBranches, setLoadingBranches] = useState(false);
  const [detecting, setDetecting] = useState(false);
  const [detectedPr, setDetectedPr] = useState<{ url: string; title: string; number: number } | null>(null);
  const [suggestedTemplateId, setSuggestedTemplateId] = useState<string | null>(null);
  const [selectedTemplateId, setSelectedTemplateId] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);

  const addTask = useTaskStore((s) => s.addTask);
  const updateTask = useTaskStore((s) => s.updateTask);
  const importBranchTask = useTaskStore((s) => s.importBranchTask);
  const stageTemplates = useTaskStore((s) => s.stageTemplates);
  const activeProject = useProjectStore((s) => s.activeProject);
  const defaultBranch = useGitHubStore((s) => s.defaultBranch);

  const projectPath = activeProject?.path ?? "";
  const isEditing = !!task;

  // Load branches when switching to import mode — fetch from remote for freshness
  useEffect(() => {
    if (mode !== "import" || !projectPath) return;
    let cancelled = false;
    setLoadingBranches(true);
    gitListBranches(projectPath, { fetch: true }).then((branches) => {
      if (!cancelled) {
        setAllBranches(branches);
        setLoadingBranches(false);
      }
    }).catch(() => {
      if (!cancelled) setLoadingBranches(false);
    });
    return () => { cancelled = true; };
  }, [mode, projectPath]);

  // Detect PR when branch is selected
  const detectBranch = useCallback(async (branch: string) => {
    if (!branch || !projectPath) return;
    setBranchName(branch);
    setBranchFilter(branch);
    setDetecting(true);
    setDetectedPr(null);
    setSuggestedTemplateId(null);
    setSelectedTemplateId(null);
    setError(null);

    try {
      // Check if branch exists
      const exists = await gitBranchExists(projectPath, branch);
      if (!exists) {
        setError(`Branch "${branch}" not found locally. Try fetching first.`);
        setDetecting(false);
        return;
      }

      // Check for open PR
      const pr = await ghFindPrForBranch(projectPath, branch);
      setDetectedPr(pr);

      // Auto-fill title from PR or branch name
      if (pr) {
        setTitle(pr.title);
      } else {
        // Convert branch name to title: feature/add-auth → Add auth
        const readable = branch
          .replace(/^(feature|fix|bugfix|hotfix|chore|refactor)\//i, "")
          .replace(/[-_]/g, " ")
          .replace(/^\w/, (c) => c.toUpperCase());
        setTitle(readable);
      }

      // Suggest stage based on PR status
      const prReviewTemplate = stageTemplates.find((t) => t.output_format === "pr_review");
      const implTemplate = stageTemplates.find((t) => t.commits_changes);

      if (pr && prReviewTemplate) {
        setSuggestedTemplateId(prReviewTemplate.id);
        setSelectedTemplateId(prReviewTemplate.id);
      } else if (implTemplate) {
        // No PR — suggest implementation stage (work is in progress)
        setSuggestedTemplateId(implTemplate.id);
        setSelectedTemplateId(implTemplate.id);
      } else {
        // Fallback to first stage
        const first = stageTemplates.find((t) => t.sort_order === 0);
        if (first) {
          setSuggestedTemplateId(first.id);
          setSelectedTemplateId(first.id);
        }
      }
    } catch (err) {
      setError(`Failed to detect branch: ${err}`);
    } finally {
      setDetecting(false);
    }
  }, [projectPath, stageTemplates]);

  // New task submit
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return;
    setError(null);
    try {
      if (isEditing) {
        await updateTask(projectId, task.id, { title: title.trim() });
        sendNotification("Task updated", title.trim(), "success", { projectId, taskId: task.id });
      } else {
        await addTask(projectId, title.trim());
        sendNotification("Task created", title.trim(), "success", { projectId });
      }
      onClose();
    } catch (err) {
      setError(`Failed to ${isEditing ? "update" : "create"} task: ${err}`);
    }
  };

  // Import branch submit
  const handleImport = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim() || !branchName || !selectedTemplateId || !projectPath) return;
    setError(null);
    setImporting(true);

    try {
      const gitRepo = await isGitRepo(projectPath);
      if (!gitRepo) throw new Error("Not a git repository");

      // Create worktree for the branch
      const baseDir = await repo.getWorktreeBaseDir(projectId);
      const worktreePath = `${baseDir}/${projectId}/${branchName.replace(/\//g, "--")}--import`;
      const targetBranch = defaultBranch ?? "main";

      // Clean up stale worktree if exists
      try { await gitWorktreeRemove(projectPath, worktreePath); } catch { /* ok */ }

      // If the branch is currently checked out in the main repo, switch away first
      try {
        const current = await gitCurrentBranch(projectPath);
        if (current.trim() === branchName) {
          await gitCheckoutBranch(projectPath, targetBranch);
        }
      } catch { /* ok — best effort */ }

      // Branch exists (we verified earlier), so don't create it
      await gitWorktreeAdd(projectPath, worktreePath, branchName, false);

      const created = await importBranchTask(
        projectId,
        title.trim(),
        branchName,
        worktreePath,
        targetBranch,
        selectedTemplateId,
        detectedPr?.url,
      );

      sendNotification("Branch imported", title.trim(), "success", { projectId, taskId: created.id });
      onClose();
    } catch (err) {
      setError(`Failed to import branch: ${err}`);
    } finally {
      setImporting(false);
    }
  };

  const filteredBranches = branchFilter
    ? allBranches.filter((b) => b.toLowerCase().includes(branchFilter.toLowerCase()))
    : allBranches;

  const sortedTemplates = [...stageTemplates].sort((a, b) => a.sort_order - b.sort_order);

  // Edit mode — keep the simple form
  if (isEditing) {
    return (
      <Dialog open onOpenChange={(open) => !open && onClose()}>
        <DialogContent className="sm:max-w-[480px]">
          <DialogHeader>
            <DialogTitle>Edit Task</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSubmit}>
            <div>
              <Label>Title</Label>
              <Input
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="What needs to be done?"
                autoFocus
                className="mt-1"
              />
            </div>
            {error && (
              <Alert variant="destructive" className="mt-4">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}
            <DialogFooter className="mt-6">
              <Button type="button" variant="ghost" onClick={onClose}>
                Cancel
              </Button>
              <Button type="submit" disabled={!title.trim()}>
                Save
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-[480px]">
        <DialogHeader>
          <DialogTitle>{mode === "new" ? "New Task" : "Import Branch"}</DialogTitle>
        </DialogHeader>

        {mode === "new" ? (
          <form onSubmit={handleSubmit}>
            <div>
              <Label>Title</Label>
              <Input
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="What needs to be done?"
                autoFocus
                className="mt-1"
              />
            </div>
            {error && (
              <Alert variant="destructive" className="mt-4">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}
            <DialogFooter className="mt-6">
              <button
                type="button"
                className="mr-auto text-sm text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300"
                onClick={() => setMode("import")}
              >
                Import branch
              </button>
              <Button type="button" variant="ghost" onClick={onClose}>
                Cancel
              </Button>
              <Button type="submit" disabled={!title.trim()}>
                Create Task
              </Button>
            </DialogFooter>
          </form>
        ) : (
          <form onSubmit={handleImport}>
            {/* Branch picker */}
            <div>
              <Label>Branch</Label>
              <Input
                type="text"
                value={branchFilter}
                onChange={(e) => {
                  setBranchFilter(e.target.value);
                  // Reset detection when user types
                  if (e.target.value !== branchName) {
                    setDetectedPr(null);
                    setSuggestedTemplateId(null);
                    setSelectedTemplateId(null);
                  }
                }}
                onKeyDown={(e) => {
                  // Allow Enter to detect the typed branch name directly
                  if (e.key === "Enter" && branchFilter && branchFilter !== branchName) {
                    e.preventDefault();
                    detectBranch(branchFilter.trim());
                  }
                }}
                placeholder={loadingBranches ? "Loading branches..." : "Type to filter branches..."}
                autoFocus
                className="mt-1"
              />
              {branchFilter && branchFilter !== branchName && filteredBranches.length > 0 && (
                <div className="mt-1 max-h-40 overflow-y-auto rounded border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800">
                  {filteredBranches.slice(0, 20).map((b) => (
                    <button
                      key={b}
                      type="button"
                      className="w-full px-3 py-1.5 text-left text-sm hover:bg-zinc-100 dark:hover:bg-zinc-700 truncate"
                      onClick={() => detectBranch(b)}
                    >
                      {b}
                    </button>
                  ))}
                  {filteredBranches.length > 20 && (
                    <div className="px-3 py-1.5 text-xs text-zinc-400">
                      +{filteredBranches.length - 20} more...
                    </div>
                  )}
                </div>
              )}
              {branchFilter && !branchName && filteredBranches.length === 0 && !loadingBranches && (
                <div className="mt-1 text-xs text-zinc-400">
                  No matching branches. Press Enter to use this name directly.
                </div>
              )}
            </div>

            {/* Detection status */}
            {detecting && (
              <div className="mt-3 text-sm text-zinc-500">Detecting PR status...</div>
            )}

            {branchName && !detecting && (
              <div className="mt-3 space-y-3">
                {/* PR status */}
                {detectedPr ? (
                  <div className="rounded border border-green-200 dark:border-green-800 bg-green-50 dark:bg-green-900/20 px-3 py-2 text-sm">
                    <span className="font-medium text-green-700 dark:text-green-400">PR found:</span>{" "}
                    <span className="text-green-600 dark:text-green-300">#{detectedPr.number}</span>{" "}
                    {detectedPr.title}
                  </div>
                ) : (
                  <div className="rounded border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800/50 px-3 py-2 text-sm text-zinc-500">
                    No open PR found for this branch
                  </div>
                )}

                {/* Title */}
                <div>
                  <Label>Title</Label>
                  <Input
                    type="text"
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    placeholder="Task title"
                    className="mt-1"
                  />
                </div>

                {/* Stage picker */}
                <div>
                  <Label>Start at stage</Label>
                  <Select
                    value={selectedTemplateId ?? undefined}
                    onValueChange={setSelectedTemplateId}
                  >
                    <SelectTrigger className="mt-1">
                      <SelectValue placeholder="Select stage..." />
                    </SelectTrigger>
                    <SelectContent>
                      {sortedTemplates.map((t) => (
                        <SelectItem key={t.id} value={t.id}>
                          {t.name}
                          {t.id === suggestedTemplateId ? " (suggested)" : ""}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            )}

            {error && (
              <Alert variant="destructive" className="mt-4">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}

            <DialogFooter className="mt-6">
              <button
                type="button"
                className="mr-auto text-sm text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300"
                onClick={() => setMode("new")}
              >
                New task
              </button>
              <Button type="button" variant="ghost" onClick={onClose}>
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={!branchName || !title.trim() || !selectedTemplateId || importing}
              >
                {importing ? "Importing..." : "Import Branch"}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
