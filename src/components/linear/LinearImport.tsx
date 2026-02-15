import { useEffect, useState } from "react";
import { useLinearStore } from "../../stores/linearStore";
import { useTaskStore } from "../../stores/taskStore";
import { fetchIssueDetail } from "../../lib/linear";
import type { LinearIssue } from "../../lib/types";

interface LinearImportProps {
  projectId: string;
  onClose: () => void;
}

const priorityLabels: Record<number, { label: string; color: string }> = {
  0: { label: "None", color: "text-zinc-500" },
  1: { label: "Urgent", color: "text-red-400" },
  2: { label: "High", color: "text-orange-400" },
  3: { label: "Medium", color: "text-yellow-400" },
  4: { label: "Low", color: "text-zinc-400" },
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
      onClose();
    } finally {
      setImporting(null);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-zinc-900 border border-zinc-700 rounded-xl p-6 w-[560px] max-w-[90vw] max-h-[80vh] flex flex-col">
        <h2 className="text-lg font-semibold text-zinc-100 mb-4">
          Import from Linear
        </h2>

        <input
          type="text"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          className="w-full bg-zinc-800 text-zinc-100 border border-zinc-700 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-500 mb-3"
          placeholder="Filter issues..."
          autoFocus
        />

        <div className="flex-1 overflow-y-auto min-h-0">
          {loading && (
            <div className="text-sm text-zinc-500 text-center py-8">
              Loading issues...
            </div>
          )}
          {error && (
            <div className="text-sm text-red-400 text-center py-8">
              {error}
            </div>
          )}
          {!loading && !error && filtered.length === 0 && (
            <div className="text-sm text-zinc-500 text-center py-8">
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
                  className="w-full text-left px-3 py-2.5 rounded-lg hover:bg-zinc-800 transition-colors flex items-start gap-3 disabled:opacity-50"
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-0.5">
                      <span className="text-xs font-mono text-zinc-500">
                        {issue.identifier}
                      </span>
                      <span className="text-xs px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-400">
                        {issue.status}
                      </span>
                      <span className={`text-xs ${priority.color}`}>
                        {priority.label}
                      </span>
                    </div>
                    <div className="text-sm text-zinc-200 truncate">
                      {issue.title}
                    </div>
                  </div>
                  {importing === issue.id && (
                    <span className="text-xs text-zinc-500 mt-1">
                      Importing...
                    </span>
                  )}
                </button>
              );
            })}
        </div>

        <div className="flex justify-end mt-4 pt-3 border-t border-zinc-800">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-sm text-zinc-400 hover:text-zinc-200 transition-colors"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
