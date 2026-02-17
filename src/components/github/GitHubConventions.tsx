import { useEffect, useState } from "react";
import * as repo from "../../lib/repositories";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { sendNotification } from "../../lib/notifications";

interface GitHubConventionsProps {
  projectId: string;
  onClose: () => void;
}

export function GitHubConventions({ projectId, onClose }: GitHubConventionsProps) {
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-[560px] max-h-[85vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>Project Conventions</DialogTitle>
        </DialogHeader>
        <GitHubConventionsContent projectId={projectId} />
        <Separator />
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function GitHubConventionsContent({ projectId }: { projectId: string }) {
  const [commitFormat, setCommitFormat] = useState("");
  const [branchNaming, setBranchNaming] = useState("");
  const [prTemplate, setPrTemplate] = useState("");
  const [extraRules, setExtraRules] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

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
    sendNotification("Conventions saved", undefined, "success", { projectId });
  };

  return (
    <>
      <p className="text-xs text-muted-foreground mb-4">
        Define how commits, branches, and PRs should be formatted. These rules are used when generating commit messages and creating branches.
      </p>

      {loading ? (
        <div className="text-sm text-muted-foreground text-center py-8">Loading...</div>
      ) : (
        <div className="flex-1 overflow-y-auto min-h-0 space-y-4">
          <div>
            <Label>Commit Message Format</Label>
            <Textarea
              value={commitFormat}
              onChange={(e) => setCommitFormat(e.target.value)}
              rows={4}
              className="mt-1 font-mono resize-none"
              placeholder={"e.g. Conventional Commits:\n<type>(<scope>): <description>\n\nTypes: feat, fix, refactor, docs, test, chore"}
            />
          </div>

          <div>
            <Label>Branch Naming</Label>
            <Textarea
              value={branchNaming}
              onChange={(e) => setBranchNaming(e.target.value)}
              rows={3}
              className="mt-1 font-mono resize-none"
              placeholder={"e.g. feature/<ticket>-<short-description>\n    fix/<ticket>-<short-description>"}
            />
          </div>

          <div>
            <Label>PR Description Template</Label>
            <Textarea
              value={prTemplate}
              onChange={(e) => setPrTemplate(e.target.value)}
              rows={4}
              className="mt-1 font-mono resize-none"
              placeholder={"e.g.\n## Summary\n\n## Changes\n\n## Testing"}
            />
          </div>

          <div>
            <Label>Additional Rules</Label>
            <Textarea
              value={extraRules}
              onChange={(e) => setExtraRules(e.target.value)}
              rows={3}
              className="mt-1 font-mono resize-none"
              placeholder="Any other conventions or rules for this project..."
            />
          </div>
        </div>
      )}

      <Separator />
      <div className="flex items-center justify-end gap-3">
        <Button
          onClick={handleSave}
          disabled={saving || loading}
        >
          {saving ? "Saving..." : "Save"}
        </Button>
      </div>
    </>
  );
}
