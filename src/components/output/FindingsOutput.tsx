import { useState } from "react";
import { TextOutput } from "./TextOutput";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Loader2 } from "lucide-react";
import type { FindingItem } from "../../lib/types";

interface FindingsOutputProps {
  output: string;
  onApplySelected: (selectedFindings: string) => void;
  onSkipAll: () => void;
  isApproved: boolean;
  approving?: boolean;
}

const severityVariant: Record<string, "critical" | "warning" | "info"> = {
  critical: "critical",
  warning: "warning",
  info: "info",
};

const severityCardColors = {
  critical: { border: "border-red-200 dark:border-red-500/20", bg: "bg-red-50 dark:bg-red-500/10", bgDeselected: "bg-zinc-50 dark:bg-zinc-900 opacity-60" },
  warning: { border: "border-amber-200 dark:border-amber-500/20", bg: "bg-amber-50 dark:bg-amber-500/10", bgDeselected: "bg-zinc-50 dark:bg-zinc-900 opacity-60" },
  info: { border: "border-blue-200 dark:border-blue-500/20", bg: "bg-blue-50 dark:bg-blue-500/10", bgDeselected: "bg-zinc-50 dark:bg-zinc-900 opacity-60" },
};

export function FindingsOutput({
  output,
  onApplySelected,
  onSkipAll,
  isApproved,
  approving,
}: FindingsOutputProps) {
  let summary = "";
  let initialFindings: FindingItem[] = [];

  try {
    const parsed = JSON.parse(output);
    summary = parsed.summary ?? "";
    initialFindings = (parsed.findings ?? []).map((f: FindingItem) => ({
      ...f,
      selected: f.selected ?? true,
    }));
  } catch {
    return (
      <div>
        <TextOutput content={output} />
        {!isApproved && (
          <Button variant="success" onClick={onSkipAll} disabled={approving} className="mt-4">
            {approving && <Loader2 className="w-4 h-4 animate-spin" />}
            {approving ? "Approving..." : "Approve & Continue"}
          </Button>
        )}
      </div>
    );
  }

  const hasFindings = initialFindings.length > 0;

  if (!hasFindings) {
    return (
      <div>
        <TextOutput content={summary} />
        {!isApproved && (
          <Alert className="mt-6 border-emerald-200 dark:border-emerald-500/20 bg-emerald-50 dark:bg-emerald-500/10 text-emerald-800 dark:text-emerald-300">
            <AlertDescription className="text-emerald-800 dark:text-emerald-300">
              <p className="text-sm font-medium mb-3">
                No findings — everything looks good.
              </p>
              <Button variant="success" onClick={onSkipAll} disabled={approving}>
                {approving && <Loader2 className="w-4 h-4 animate-spin" />}
                {approving ? "Approving..." : "Approve & Continue"}
              </Button>
            </AlertDescription>
          </Alert>
        )}
      </div>
    );
  }

  return (
    <div>
      <TextOutput content={summary} />
      <FindingsCards
        findings={initialFindings}
        onApplySelected={onApplySelected}
        onSkipAll={onSkipAll}
        isApproved={isApproved}
        approving={approving}
      />
    </div>
  );
}

function FindingsCards({
  findings: initialFindings,
  onApplySelected,
  onSkipAll,
  isApproved,
  approving,
}: {
  findings: FindingItem[];
  onApplySelected: (selectedFindings: string) => void;
  onSkipAll: () => void;
  isApproved: boolean;
  approving?: boolean;
}) {
  const [findings, setFindings] = useState<FindingItem[]>(initialFindings);
  const [applying, setApplying] = useState(false);

  const selectedCount = findings.filter((f) => f.selected).length;
  const allSelected = selectedCount === findings.length;

  const toggleFinding = (id: string) => {
    if (isApproved) return;
    setFindings((prev) =>
      prev.map((f) => (f.id === id ? { ...f, selected: !f.selected } : f)),
    );
  };

  const toggleAll = () => {
    if (isApproved) return;
    const newValue = !allSelected;
    setFindings((prev) => prev.map((f) => ({ ...f, selected: newValue })));
  };

  const handleApply = () => {
    setApplying(true);
    const selected = findings.filter((f) => f.selected);
    const text = selected
      .map(
        (f, i) =>
          `${i + 1}. [${f.severity.toUpperCase()}] ${f.title}${f.file_path ? ` (${f.file_path})` : ""}\n   ${f.description}`,
      )
      .join("\n\n");
    onApplySelected(text);
  };

  return (
    <div className="mt-6">
      {!isApproved && (
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-medium text-foreground">
            {findings.length} finding{findings.length !== 1 ? "s" : ""}
          </h3>
          <Button variant="ghost" size="sm" onClick={toggleAll}>
            {allSelected ? "Deselect All" : "Select All"}
          </Button>
        </div>
      )}

      <div className="space-y-3">
        {findings.map((finding) => {
          const colors =
            severityCardColors[finding.severity] ?? severityCardColors.info;
          const badgeVar = severityVariant[finding.severity] ?? "info";
          return (
            <div
              key={finding.id}
              onClick={() => toggleFinding(finding.id)}
              className={`rounded-lg border p-4 transition-colors ${
                isApproved ? "" : "cursor-pointer"
              } ${colors.border} ${
                finding.selected ? colors.bg : colors.bgDeselected
              }`}
            >
              <div className="flex items-start gap-3">
                <Checkbox
                  checked={finding.selected}
                  onCheckedChange={() => toggleFinding(finding.id)}
                  disabled={isApproved}
                  onClick={(e) => e.stopPropagation()}
                  className="mt-0.5"
                />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1 flex-wrap">
                    <Badge variant={badgeVar} className="text-[10px] uppercase font-bold">
                      {finding.severity}
                    </Badge>
                    {finding.category && (
                      <Badge variant="secondary" className="text-[10px] uppercase font-medium">
                        {finding.category}
                      </Badge>
                    )}
                    {finding.file_path && (
                      <span className="text-xs text-muted-foreground font-mono truncate">
                        {finding.file_path}
                      </span>
                    )}
                  </div>
                  <p className="text-sm font-medium text-foreground">
                    {finding.title}
                  </p>
                  <p className="text-sm text-muted-foreground mt-1">
                    {finding.description}
                  </p>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {!isApproved && (
        <div className="flex items-center gap-3 mt-4">
          <Button
            variant="success"
            onClick={handleApply}
            disabled={selectedCount === 0 || applying}
          >
            {applying && <Loader2 className="w-4 h-4 animate-spin" />}
            {applying ? "Applying..." : `Apply Selected (${selectedCount})`}
          </Button>
          <Button variant="outline" onClick={onSkipAll} disabled={approving || applying}>
            {approving && <Loader2 className="w-4 h-4 animate-spin" />}
            {approving ? "Skipping..." : "Skip All"}
          </Button>
        </div>
      )}
    </div>
  );
}
