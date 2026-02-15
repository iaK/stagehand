import { useState } from "react";
import { TextOutput } from "./TextOutput";
import type { FindingItem } from "../../lib/types";

interface FindingsOutputProps {
  output: string;
  onApplySelected: (selectedFindings: string) => void;
  onSkipAll: () => void;
  isApproved: boolean;
}

const severityColors = {
  critical: {
    border: "border-red-800",
    bg: "bg-red-950/30",
    badge: "bg-red-900 text-red-300",
  },
  warning: {
    border: "border-amber-800",
    bg: "bg-amber-950/30",
    badge: "bg-amber-900 text-amber-300",
  },
  info: {
    border: "border-blue-800",
    bg: "bg-blue-950/30",
    badge: "bg-blue-900 text-blue-300",
  },
};

export function FindingsOutput({
  output,
  onApplySelected,
  onSkipAll,
  isApproved,
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
          <button
            onClick={onSkipAll}
            className="mt-4 px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg text-sm font-medium transition-colors"
          >
            Approve & Continue
          </button>
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
          <div className="mt-6 p-4 bg-emerald-950/30 border border-emerald-800 rounded-lg">
            <p className="text-sm text-emerald-300 font-medium mb-3">
              No findings — everything looks good.
            </p>
            <button
              onClick={onSkipAll}
              className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg text-sm font-medium transition-colors"
            >
              Approve & Continue
            </button>
          </div>
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
      />
    </div>
  );
}

function FindingsCards({
  findings: initialFindings,
  onApplySelected,
  onSkipAll,
  isApproved,
}: {
  findings: FindingItem[];
  onApplySelected: (selectedFindings: string) => void;
  onSkipAll: () => void;
  isApproved: boolean;
}) {
  const [findings, setFindings] = useState<FindingItem[]>(initialFindings);

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
      {/* Select All / Deselect All toggle */}
      {!isApproved && (
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-medium text-zinc-300">
            {findings.length} finding{findings.length !== 1 ? "s" : ""}
          </h3>
          <button
            onClick={toggleAll}
            className="text-xs text-zinc-400 hover:text-zinc-200 transition-colors"
          >
            {allSelected ? "Deselect All" : "Select All"}
          </button>
        </div>
      )}

      <div className="space-y-3">
        {findings.map((finding) => {
          const colors =
            severityColors[finding.severity] ?? severityColors.info;
          return (
            <div
              key={finding.id}
              onClick={() => toggleFinding(finding.id)}
              className={`rounded-lg border p-4 transition-colors ${
                isApproved ? "" : "cursor-pointer"
              } ${colors.border} ${
                finding.selected ? colors.bg : "bg-zinc-900/50 opacity-60"
              }`}
            >
              <div className="flex items-start gap-3">
                <input
                  type="checkbox"
                  checked={finding.selected}
                  onChange={() => toggleFinding(finding.id)}
                  disabled={isApproved}
                  onClick={(e) => e.stopPropagation()}
                  className="mt-0.5 accent-emerald-500"
                />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1 flex-wrap">
                    <span
                      className={`text-[10px] uppercase font-bold px-1.5 py-0.5 rounded ${colors.badge}`}
                    >
                      {finding.severity}
                    </span>
                    {finding.category && (
                      <span className="text-[10px] uppercase font-medium px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-400">
                        {finding.category}
                      </span>
                    )}
                    {finding.file_path && (
                      <span className="text-xs text-zinc-500 font-mono truncate">
                        {finding.file_path}
                      </span>
                    )}
                  </div>
                  <p className="text-sm font-medium text-zinc-200">
                    {finding.title}
                  </p>
                  <p className="text-sm text-zinc-400 mt-1">
                    {finding.description}
                  </p>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Action buttons */}
      {!isApproved && (
        <div className="flex items-center gap-3 mt-4">
          <button
            onClick={handleApply}
            disabled={selectedCount === 0}
            className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 disabled:bg-zinc-700 disabled:text-zinc-500 text-white rounded-lg text-sm font-medium transition-colors"
          >
            Apply Selected ({selectedCount})
          </button>
          <button
            onClick={onSkipAll}
            className="px-4 py-2 border border-zinc-700 text-zinc-300 hover:bg-zinc-800 rounded-lg text-sm transition-colors"
          >
            Skip All
          </button>
        </div>
      )}
    </div>
  );
}
