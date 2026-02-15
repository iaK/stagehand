import { useEffect, useState } from "react";
import * as repo from "../../lib/repositories";

interface GitHubConventionsProps {
  projectId: string;
  onClose: () => void;
}

export function GitHubConventions({ projectId, onClose }: GitHubConventionsProps) {
  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-zinc-900 border border-zinc-700 rounded-xl p-6 w-[560px] max-w-[90vw] max-h-[85vh] flex flex-col">
        <h2 className="text-lg font-semibold text-zinc-100 mb-1">
          Project Conventions
        </h2>
        <GitHubConventionsContent projectId={projectId} />
        <div className="flex justify-end mt-4 pt-3 border-t border-zinc-800">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-sm text-zinc-400 hover:text-zinc-200 transition-colors"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

export function GitHubConventionsContent({ projectId }: { projectId: string }) {
  const [commitFormat, setCommitFormat] = useState("");
  const [branchNaming, setBranchNaming] = useState("");
  const [prTemplate, setPrTemplate] = useState("");
  const [extraRules, setExtraRules] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    (async () => {
      const [cf, bn, pr, er] = await Promise.all([
        repo.getProjectSetting(projectId, "conv_commit_format"),
        repo.getProjectSetting(projectId, "conv_branch_naming"),
        repo.getProjectSetting(projectId, "conv_pr_template"),
        repo.getProjectSetting(projectId, "conv_extra_rules"),
      ]);
      setCommitFormat(cf ?? "");
      setBranchNaming(bn ?? "");
      setPrTemplate(pr ?? "");
      setExtraRules(er ?? "");
      setLoading(false);
    })();
  }, [projectId]);

  const handleSave = async () => {
    setSaving(true);
    setSaved(false);

    const settings: [string, string][] = [
      ["conv_commit_format", commitFormat],
      ["conv_branch_naming", branchNaming],
      ["conv_pr_template", prTemplate],
      ["conv_extra_rules", extraRules],
    ];

    for (const [key, value] of settings) {
      if (value.trim()) {
        await repo.setProjectSetting(projectId, key, value.trim());
      } else {
        await repo.deleteProjectSetting(projectId, key);
      }
    }

    // Also assemble into github_commit_rules for use by commit message generation
    const parts: string[] = [];
    if (commitFormat.trim()) {
      parts.push(`## Commit Message Format\n\n${commitFormat.trim()}`);
    }
    if (branchNaming.trim()) {
      parts.push(`## Branch Naming\n\n${branchNaming.trim()}`);
    }
    if (prTemplate.trim()) {
      parts.push(`## PR Template\n\n${prTemplate.trim()}`);
    }
    if (extraRules.trim()) {
      parts.push(`## Additional Rules\n\n${extraRules.trim()}`);
    }

    if (parts.length > 0) {
      await repo.setProjectSetting(projectId, "github_commit_rules", parts.join("\n\n---\n\n"));
    } else {
      await repo.deleteProjectSetting(projectId, "github_commit_rules");
    }

    setSaving(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  return (
    <>
      <p className="text-xs text-zinc-500 mb-4">
        Define how commits, branches, and PRs should be formatted. These rules are used when generating commit messages and creating branches.
      </p>

      {loading ? (
        <div className="text-sm text-zinc-500 text-center py-8">Loading...</div>
      ) : (
        <div className="flex-1 overflow-y-auto min-h-0 space-y-4">
          <div>
            <label className="block text-sm text-zinc-400 mb-1">
              Commit Message Format
            </label>
            <textarea
              value={commitFormat}
              onChange={(e) => setCommitFormat(e.target.value)}
              rows={4}
              className="w-full bg-zinc-800 text-zinc-100 border border-zinc-700 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:border-blue-500 resize-none"
              placeholder={"e.g. Conventional Commits:\n<type>(<scope>): <description>\n\nTypes: feat, fix, refactor, docs, test, chore"}
            />
          </div>

          <div>
            <label className="block text-sm text-zinc-400 mb-1">
              Branch Naming
            </label>
            <textarea
              value={branchNaming}
              onChange={(e) => setBranchNaming(e.target.value)}
              rows={3}
              className="w-full bg-zinc-800 text-zinc-100 border border-zinc-700 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:border-blue-500 resize-none"
              placeholder={"e.g. feature/<ticket>-<short-description>\n    fix/<ticket>-<short-description>"}
            />
          </div>

          <div>
            <label className="block text-sm text-zinc-400 mb-1">
              PR Description Template
            </label>
            <textarea
              value={prTemplate}
              onChange={(e) => setPrTemplate(e.target.value)}
              rows={4}
              className="w-full bg-zinc-800 text-zinc-100 border border-zinc-700 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:border-blue-500 resize-none"
              placeholder={"e.g.\n## Summary\n\n## Changes\n\n## Testing"}
            />
          </div>

          <div>
            <label className="block text-sm text-zinc-400 mb-1">
              Additional Rules
            </label>
            <textarea
              value={extraRules}
              onChange={(e) => setExtraRules(e.target.value)}
              rows={3}
              className="w-full bg-zinc-800 text-zinc-100 border border-zinc-700 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:border-blue-500 resize-none"
              placeholder="Any other conventions or rules for this project..."
            />
          </div>
        </div>
      )}

      <div className="flex items-center justify-end gap-3 mt-4 pt-3 border-t border-zinc-800">
        {saved && (
          <span className="text-xs text-emerald-400">Saved</span>
        )}
        <button
          onClick={handleSave}
          disabled={saving || loading}
          className="px-4 py-2 text-sm bg-blue-600 hover:bg-blue-500 disabled:bg-zinc-700 disabled:text-zinc-500 text-white rounded-lg transition-colors"
        >
          {saving ? "Saving..." : "Save"}
        </button>
      </div>
    </>
  );
}
