import { useEffect, useState } from "react";
import { useLinearStore } from "../../stores/linearStore";
import { useTaskStore } from "../../stores/taskStore";
import { fetchIssueDetail } from "../../lib/linear";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { sendNotification } from "../../lib/notifications";
import type { LinearIssue } from "../../lib/types";

interface LinearImportProps {
  projectId: string;
  onClose: () => void;
}

const priorityLabels: Record<number, { label: string; color: string }> = {
  0: { label: "None", color: "text-muted-foreground" },
  1: { label: "Urgent", color: "text-red-600" },
  2: { label: "High", color: "text-orange-600" },
  3: { label: "Medium", color: "text-yellow-600" },
  4: { label: "Low", color: "text-muted-foreground" },
};

export function LinearImport({ projectId, onClose }: LinearImportProps) {
  const { issues, loading, error, fetchIssues } = useLinearStore();
  const addTask = useTaskStore((s) => s.addTask);
  const [filter, setFilter] = useState("");
  const [importing, setImporting] = useState<string | null>(null);

  useEffect(() => {
    fetchIssues();
  }, [fetchIssues]);

  const filtered = issues.filter((issue) => {
    const q = filter.toLowerCase();
    return (
      issue.identifier.toLowerCase().includes(q) ||
      issue.title.toLowerCase().includes(q) ||
      issue.status.toLowerCase().includes(q)
    );
  });

  const apiKey = useLinearStore((s) => s.apiKey);

  const handleImport = async (issue: LinearIssue) => {
    if (!apiKey) return;
    setImporting(issue.id);
    try {
      const detail = await fetchIssueDetail(apiKey, issue.id);

      // Compose description from ticket info, description, and comments
      const parts: string[] = [`Linear ticket: ${issue.identifier} — ${issue.title}`];
      if (detail.description) {
        parts.push(`\n## Description\n${detail.description}`);
      }
      if (detail.comments.length > 0) {
        parts.push(`\n## Comments\n${detail.comments.join("\n\n")}`);
      }
      const description = parts.join("\n");

      const title = `[${issue.identifier}] ${issue.title}`;
      await addTask(projectId, title, description, issue.branchName);
      sendNotification("Task imported", title);
      onClose();
    } finally {
      setImporting(null);
    }
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-[560px] max-h-[80vh] !flex !flex-col overflow-hidden">
        <DialogHeader>
          <DialogTitle>Import from Linear</DialogTitle>
        </DialogHeader>

        <Input
          type="text"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Filter issues..."
          autoFocus
        />

        <div className="flex-1 min-h-0 overflow-y-auto">
          {loading && (
            <div className="text-sm text-muted-foreground text-center py-8">
              Loading issues...
            </div>
          )}
          {error && (
            <div className="text-sm text-destructive text-center py-8">
              {error}
            </div>
          )}
          {!loading && !error && filtered.length === 0 && (
            <div className="text-sm text-muted-foreground text-center py-8">
              {issues.length === 0
                ? "No assigned issues found"
                : "No issues match your filter"}
            </div>
          )}
          {!loading &&
            filtered.map((issue) => {
              const priority = priorityLabels[issue.priority] ?? priorityLabels[0];
              return (
                <button
                  key={issue.id}
                  onClick={() => handleImport(issue)}
                  disabled={importing !== null}
                  className="w-full text-left px-3 py-2.5 rounded-lg hover:bg-accent transition-colors flex items-start gap-3 disabled:opacity-50"
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-0.5">
                      <span className="text-xs font-mono text-muted-foreground">
                        {issue.identifier}
                      </span>
                      <Badge variant="secondary">
                        {issue.status}
                      </Badge>
                      <span className={`text-xs ${priority.color}`}>
                        {priority.label}
                      </span>
                    </div>
                    <div className="text-sm text-foreground truncate">
                      {issue.title}
                    </div>
                  </div>
                  {importing === issue.id && (
                    <span className="text-xs text-muted-foreground mt-1">
                      Importing...
                    </span>
                  )}
                </button>
              );
            })}
        </div>

        <Separator />
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
