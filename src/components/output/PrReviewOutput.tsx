import { useState } from "react";
import { TextOutput } from "./TextOutput";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Alert, AlertDescription } from "@/components/ui/alert";
import type { PrReviewFix } from "../../lib/types";

interface PrReviewOutputProps {
  fixes: PrReviewFix[];
  fixingId: string | null;
  onFix: (fixId: string, context?: string) => void;
  onSkip: (fixId: string) => void;
  onMarkDone: () => void;
  onRefresh: () => void;
  loading: boolean;
  isCompleted: boolean;
  error: string | null;
  streamOutput?: string[];
}

const stateColors: Record<string, { badge: "critical" | "warning" | "info" | "secondary"; label: string }> = {
  CHANGES_REQUESTED: { badge: "critical", label: "Changes Requested" },
  COMMENTED: { badge: "info", label: "Commented" },
  APPROVED: { badge: "secondary", label: "Approved" },
  DISMISSED: { badge: "secondary", label: "Dismissed" },
  PENDING: { badge: "warning", label: "Pending" },
};

const fixStatusColors: Record<string, { badge: "secondary" | "warning" | "info" | "critical"; label: string }> = {
  pending: { badge: "secondary", label: "Pending" },
  fixing: { badge: "warning", label: "Fixing..." },
  fixed: { badge: "info", label: "Fixed" },
  skipped: { badge: "secondary", label: "Skipped" },
};

export function PrReviewOutput({
  fixes,
  fixingId,
  onFix,
  onSkip,
  onMarkDone,
  onRefresh,
  loading,
  isCompleted,
  error,
  streamOutput,
}: PrReviewOutputProps) {
  const fixedCount = fixes.filter((f) => f.fix_status === "fixed").length;
  const skippedCount = fixes.filter((f) => f.fix_status === "skipped").length;
  const pendingCount = fixes.filter((f) => f.fix_status === "pending").length;

  // Sort: pending items first, then fixing, then fixed/skipped/approved/dismissed at bottom
  const sortedFixes = [...fixes].sort((a, b) => {
    const resolvedStates = ["APPROVED", "DISMISSED"];
    const doneStatuses = ["fixed", "skipped"];
    const aResolved = resolvedStates.includes(a.state) || doneStatuses.includes(a.fix_status) ? 1 : 0;
    const bResolved = resolvedStates.includes(b.state) || doneStatuses.includes(b.fix_status) ? 1 : 0;
    if (aResolved !== bResolved) return aResolved - bResolved;
    return 0;
  });

  if (fixes.length === 0 && loading) {
    return (
      <div className="space-y-4">
        <div className="flex items-center gap-3 py-8 justify-center text-muted-foreground">
          <svg className="w-5 h-5 animate-spin" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
          </svg>
          <p className="text-sm">Fetching PR reviews...</p>
        </div>
      </div>
    );
  }

  if (fixes.length === 0 && !loading) {
    return (
      <div className="space-y-4">
        <div className="text-center py-8 text-muted-foreground">
          <p className="text-sm">No reviews yet. Polling every 60s...</p>
          <Button variant="outline" size="sm" onClick={onRefresh} className="mt-3">
            Refresh Now
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header summary */}
      <div className="flex items-center justify-between">
        <div className="text-sm text-muted-foreground">
          {fixes.length} comment{fixes.length !== 1 ? "s" : ""}
          {fixedCount > 0 && <span className="text-emerald-600 ml-2">{fixedCount} fixed</span>}
          {skippedCount > 0 && <span className="text-zinc-500 ml-2">{skippedCount} skipped</span>}
          {pendingCount > 0 && <span className="text-blue-600 ml-2">{pendingCount} pending</span>}
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={onRefresh}
            disabled={loading}
          >
            {loading ? "Refreshing..." : "Refresh"}
          </Button>
          {!isCompleted && (
            <Button
              variant="success"
              size="sm"
              onClick={() => {
                if (pendingCount > 0) {
                  if (!window.confirm(`There are still ${pendingCount} pending comment(s). Mark as done anyway?`)) return;
                }
                onMarkDone();
              }}
              disabled={!!fixingId}
            >
              Mark as Done
            </Button>
          )}
        </div>
      </div>

      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {/* Review cards */}
      <div className="space-y-3">
        {sortedFixes.map((fix) => (
          <ReviewCard
            key={fix.id}
            fix={fix}
            fixingId={fixingId}
            onFix={onFix}
            onSkip={onSkip}
            isCompleted={isCompleted}
            streamOutput={fixingId === fix.id ? streamOutput : undefined}
          />
        ))}
      </div>

      {isCompleted && (
        <Alert className="border-emerald-200 bg-emerald-50 text-emerald-800">
          <svg className="w-4 h-4 text-emerald-600 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
            <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
          </svg>
          <AlertDescription className="text-emerald-800">
            PR Review completed. Task marked as done.
          </AlertDescription>
        </Alert>
      )}
    </div>
  );
}

function ReviewCard({
  fix,
  fixingId,
  onFix,
  onSkip,
  isCompleted,
  streamOutput,
}: {
  fix: PrReviewFix;
  fixingId: string | null;
  onFix: (fixId: string, context?: string) => void;
  onSkip: (fixId: string) => void;
  isCompleted: boolean;
  streamOutput?: string[];
}) {
  const [context, setContext] = useState("");
  const isResolved = fix.state === "APPROVED" || fix.state === "DISMISSED" || fix.fix_status === "fixed" || fix.fix_status === "skipped";
  const isFixing = fix.id === fixingId;

  const stateInfo = stateColors[fix.state] ?? { badge: "secondary" as const, label: fix.state };
  const fixInfo = fixStatusColors[fix.fix_status] ?? fixStatusColors.pending;

  const cardBorderColor = isResolved
    ? "border-zinc-200"
    : fix.state === "CHANGES_REQUESTED"
      ? "border-red-200"
      : "border-blue-200";

  const cardBgColor = isResolved
    ? "bg-zinc-50"
    : fix.state === "CHANGES_REQUESTED"
      ? "bg-red-50/50"
      : "bg-blue-50/50";

  return (
    <div
      className={`rounded-lg border p-4 transition-colors ${cardBorderColor} ${cardBgColor} ${
        isResolved ? "opacity-60" : ""
      }`}
    >
      <div className="flex items-start gap-3">
        {/* Avatar */}
        {fix.author_avatar_url ? (
          <img
            src={fix.author_avatar_url}
            alt={fix.author}
            className="w-8 h-8 rounded-full flex-shrink-0"
          />
        ) : (
          <div className="w-8 h-8 rounded-full bg-zinc-300 flex-shrink-0 flex items-center justify-center text-xs font-medium text-zinc-600">
            {fix.author.charAt(0).toUpperCase()}
          </div>
        )}

        <div className="flex-1 min-w-0">
          {/* Header row */}
          <div className="flex items-center gap-2 mb-1.5 flex-wrap">
            <span className="text-sm font-medium text-foreground">{fix.author}</span>
            <Badge variant={stateInfo.badge} className="text-[10px] uppercase font-bold">
              {stateInfo.label}
            </Badge>
            {fix.comment_type !== "review" && (
              <Badge variant="secondary" className="text-[10px] uppercase font-medium">
                {fix.comment_type}
              </Badge>
            )}
            <Badge variant={fixInfo.badge} className="text-[10px] uppercase font-bold">
              {fixInfo.label}
              {fix.fix_commit_hash && ` (${fix.fix_commit_hash})`}
            </Badge>
          </div>

          {/* File path + line */}
          {fix.file_path && (
            <p className="text-xs text-muted-foreground font-mono mb-1.5">
              {fix.file_path}
              {fix.line ? `:${fix.line}` : ""}
            </p>
          )}

          {/* Body */}
          <div className={isResolved ? "line-through" : ""}>
            <TextOutput content={fix.body} />
          </div>

          {/* Diff hunk */}
          {fix.diff_hunk && (
            <pre className="text-xs text-muted-foreground bg-zinc-100 dark:bg-zinc-900 border border-border rounded p-2 mt-2 overflow-x-auto font-mono whitespace-pre-wrap">
              {fix.diff_hunk}
            </pre>
          )}

          {/* Stream output while fixing */}
          {isFixing && streamOutput && streamOutput.length > 0 && (
            <div className="mt-3 bg-zinc-900 text-zinc-100 rounded-lg p-3 max-h-48 overflow-y-auto">
              <pre className="text-xs font-mono whitespace-pre-wrap">
                {streamOutput.slice(-50).join("")}
              </pre>
            </div>
          )}

          {/* Actions */}
          {!isCompleted && !isResolved && fix.fix_status === "pending" && !fixingId && (
            <div className="flex items-center gap-2 mt-3">
              <Input
                value={context}
                onChange={(e) => setContext(e.target.value)}
                placeholder="Optional context for the fix..."
                className="text-xs h-8 max-w-sm"
              />
              <Button
                size="sm"
                onClick={() => onFix(fix.id, context || undefined)}
              >
                Fix
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => onSkip(fix.id)}
              >
                Skip
              </Button>
            </div>
          )}

          {isFixing && (
            <div className="flex items-center gap-2 mt-3 text-amber-600">
              <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
              </svg>
              <span className="text-sm font-medium">Fixing this comment...</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
