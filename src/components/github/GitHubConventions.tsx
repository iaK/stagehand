import { useEffect, useState } from "react";
import * as repo from "../../lib/repositories";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { sendNotification } from "../../lib/notifications";
import type { CompletionStrategy } from "../../lib/types";

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
  const [completionStrategy, setCompletionStrategy] = useState<CompletionStrategy>("pr");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    (async () => {
      const [cf, bn, pr, er, cs] = await Promise.all([
        repo.getProjectSetting(projectId, "conv_commit_format"),
        repo.getProjectSetting(projectId, "conv_branch_naming"),
        repo.getProjectSetting(projectId, "conv_pr_template"),
        repo.getProjectSetting(projectId, "conv_extra_rules"),
        repo.getProjectSetting(projectId, "default_completion_strategy"),
      ]);
      setCommitFormat(cf ?? "");
      setBranchNaming(bn ?? "");
      setPrTemplate(pr ?? "");
      setExtraRules(er ?? "");
      setCompletionStrategy((cs as CompletionStrategy) ?? "pr");
      setLoading(false);
    })();
  }, [projectId]);

  const handleSave = async () => {
    setSaving(true);

    await repo.setProjectSetting(projectId, "default_completion_strategy", completionStrategy);

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
      <div className="mb-6">
        <h2 className="text-lg font-semibold text-foreground">Conventions</h2>
        <p className="text-sm text-muted-foreground mt-1">
          Define how commits, branches, and PRs should be formatted. These rules are used when generating commit messages and creating branches.
        </p>
      </div>

      {loading ? (
        <div className="text-sm text-muted-foreground text-center py-8">Loading...</div>
      ) : (
        <div className="flex-1 overflow-y-auto min-h-0 space-y-6">
          <div>
            <Label className="text-sm font-semibold">Task Completion Strategy</Label>
            <p className="text-xs text-muted-foreground mt-1 mb-2">
              How completed tasks are integrated into the main branch. This is the default for new tasks and can be changed per-task.
            </p>
            <RadioGroup
              value={completionStrategy}
              onValueChange={(v) => setCompletionStrategy(v as CompletionStrategy)}
              className="space-y-1.5"
            >
              <label className={`flex items-start gap-3 p-2.5 rounded-md border cursor-pointer transition-colors ${
                completionStrategy === "pr" ? "border-blue-500 bg-blue-50" : "border-border hover:border-zinc-400"
              }`}>
                <RadioGroupItem value="pr" className="mt-0.5" />
                <div>
                  <span className="text-sm font-medium text-foreground">Pull Request</span>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Push branch and create a PR on GitHub. Includes PR Preparation and PR Review stages.
                  </p>
                </div>
              </label>
              <label className={`flex items-start gap-3 p-2.5 rounded-md border cursor-pointer transition-colors ${
                completionStrategy === "direct_merge" ? "border-blue-500 bg-blue-50" : "border-border hover:border-zinc-400"
              }`}>
                <RadioGroupItem value="direct_merge" className="mt-0.5" />
                <div>
                  <span className="text-sm font-medium text-foreground">Direct Merge</span>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Merge the task branch directly into the main branch. Skips PR stages.
                  </p>
                </div>
              </label>
              <label className={`flex items-start gap-3 p-2.5 rounded-md border cursor-pointer transition-colors ${
                completionStrategy === "none" ? "border-blue-500 bg-blue-50" : "border-border hover:border-zinc-400"
              }`}>
                <RadioGroupItem value="none" className="mt-0.5" />
                <div>
                  <span className="text-sm font-medium text-foreground">None</span>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Leave the branch as-is. No merge or PR creation. The task completes after the last stage.
                  </p>
                </div>
              </label>
            </RadioGroup>
          </div>

          <Separator />

          <div>
            <Label className="text-sm font-semibold">Commit Message Format</Label>
            <Textarea
              value={commitFormat}
              onChange={(e) => setCommitFormat(e.target.value)}
              rows={4}
              className="mt-1 font-mono resize-none"
              placeholder={"e.g. Conventional Commits:\n<type>(<scope>): <description>\n\nTypes: feat, fix, refactor, docs, test, chore"}
            />
          </div>

          <div>
            <Label className="text-sm font-semibold">Branch Naming</Label>
            <Textarea
              value={branchNaming}
              onChange={(e) => setBranchNaming(e.target.value)}
              rows={3}
              className="mt-1 font-mono resize-none"
              placeholder={"e.g. feature/<ticket>-<short-description>\n    fix/<ticket>-<short-description>"}
            />
          </div>

          <div>
            <Label className="text-sm font-semibold">PR Description Template</Label>
            <Textarea
              value={prTemplate}
              onChange={(e) => setPrTemplate(e.target.value)}
              rows={4}
              className="mt-1 font-mono resize-none"
              placeholder={"e.g.\n## Summary\n\n## Changes\n\n## Testing"}
            />
          </div>

          <div>
            <Label className="text-sm font-semibold">Additional Rules</Label>
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

      <div className="flex items-center justify-end pt-6">
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
