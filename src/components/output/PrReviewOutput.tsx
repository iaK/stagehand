import { useState, useMemo, memo, useCallback, useEffect } from "react";
import { TextOutput } from "./TextOutput";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Loader2, ChevronRight, ChevronDown, MessageSquare, Lightbulb, Wrench, CheckCircle2, RefreshCw, ArrowUpFromLine, ArrowDownToLine } from "lucide-react";
import type { PrReviewFix } from "../../lib/types";
import type { GhReviewComment } from "../../lib/git";
import type { Consideration } from "../../hooks/usePrReview";
import { useProcessStore } from "../../stores/processStore";

const EMPTY_LINES: string[] = [];
const EMPTY_REPLIES: GhReviewComment[] = [];

// --- Suggestion parsing ---

interface BodySegment {
  type: "text" | "suggestion";
  content: string;
}

function parseBodySegments(body: string): BodySegment[] {
  const segments: BodySegment[] = [];
  const regex = /```suggestion\b[^\n]*\n([\s\S]*?)```/g;
  let lastIndex = 0;
  let match;

  while ((match = regex.exec(body)) !== null) {
    if (match.index > lastIndex) {
      segments.push({ type: "text", content: body.slice(lastIndex, match.index) });
    }
    segments.push({ type: "suggestion", content: match[1] });
    lastIndex = match.index + match[0].length;
  }

  if (lastIndex < body.length) {
    segments.push({ type: "text", content: body.slice(lastIndex) });
  }

  return segments;
}

/** Extract old line(s) from a diff_hunk at the comment position.
 *  The hunk always ends at the commented line. We take the last N content
 *  lines (matching the suggestion line count) from the new-file side
 *  (lines starting with '+' or ' '). */
function extractOldLines(diffHunk: string | null, suggestionLineCount: number): string[] {
  if (!diffHunk) return [];
  const lines = diffHunk.split("\n");
  // Collect new-file-side lines (context ' ' or added '+'), skip removed '-' and '@@'
  const newSideLines: string[] = [];
  for (const line of lines) {
    if (line.startsWith("@@")) continue;
    if (line.startsWith("-")) continue;
    newSideLines.push(line.slice(1)); // strip the prefix character
  }
  // The last N lines correspond to what the suggestion replaces
  return newSideLines.slice(-suggestionLineCount);
}

interface PrReviewOutputProps {
  fixes: PrReviewFix[];
  replies: Map<number, GhReviewComment[]>;
  fixingId: string | null;
  consideringId: string | null;
  considerations: Map<string, Consideration>;
  resolvingId: string | null;
  resolvedIds: Set<string>;
  pushing: boolean;
  pulling: boolean;
  hasBranch: boolean;
  onFix: (fixId: string, context?: string) => void;
  onConsider: (fixId: string) => void;
  onResolve: (fixId: string) => void;
  onUnresolve: (fixId: string) => void;
  onReply: (commentId: number, body: string) => Promise<void>;
  onPush: () => void;
  onPull: () => void;
  onRefresh: () => void;
  onOpenFile?: (filePath: string) => void;
  loading: boolean;
  isCompleted: boolean;
  error: string | null;
  stageKey: string;
  summary: string | null;
  summaryLoading: boolean;
}

const stateColors: Record<string, { badge: "critical" | "warning" | "info" | "secondary"; label: string }> = {
  CHANGES_REQUESTED: { badge: "critical", label: "Changes Requested" },
  COMMENTED: { badge: "info", label: "Commented" },
  APPROVED: { badge: "secondary", label: "Approved" },
  DISMISSED: { badge: "secondary", label: "Dismissed" },
  PENDING: { badge: "warning", label: "Pending" },
};


// --- Grouping logic ---

interface ReviewGroup {
  key: string;
  reviewId: number | null;
  author: string;
  authorAvatarUrl: string | null;
  state: string;
  submittedAt: string | null;
  reviewBody: PrReviewFix | null; // review-level comment (may have empty body)
  comments: PrReviewFix[]; // inline comments in this review
  allResolved: boolean;
  resolvedCount: number;
  totalCount: number; // actionable items (excludes empty review body placeholders)
}

function isFixResolved(fix: PrReviewFix, resolvedIds?: Set<string>): boolean {
  return (
    fix.state === "APPROVED" ||
    fix.state === "DISMISSED" ||
    (resolvedIds != null && resolvedIds.has(fix.id))
  );
}

function buildGroups(fixes: PrReviewFix[], resolvedIds: Set<string>): ReviewGroup[] {
  const groupMap = new Map<string, ReviewGroup>();
  const order: string[] = [];

  for (const fix of fixes) {
    if (fix.comment_type === "conversation" || fix.review_id == null) {
      // Standalone group — conversation comments are individually actionable
      const key = `standalone-${fix.id}`;
      order.push(key);
      groupMap.set(key, {
        key,
        reviewId: null,
        author: fix.author,
        authorAvatarUrl: fix.author_avatar_url,
        state: fix.state,
        submittedAt: fix.submitted_at,
        reviewBody: fix,
        comments: [],
        allResolved: isFixResolved(fix, resolvedIds),
        resolvedCount: isFixResolved(fix, resolvedIds) ? 1 : 0,
        totalCount: 1,
      });
    } else if (fix.comment_type === "review") {
      // Review body is never counted toward resolution — only inline children matter
      const key = `review-${fix.review_id}`;
      const existing = groupMap.get(key);
      if (existing) {
        existing.reviewBody = fix;
        existing.state = fix.state;
        existing.author = fix.author;
        existing.authorAvatarUrl = fix.author_avatar_url;
        if (fix.submitted_at) existing.submittedAt = fix.submitted_at;
      } else {
        order.push(key);
        groupMap.set(key, {
          key,
          reviewId: fix.review_id,
          author: fix.author,
          authorAvatarUrl: fix.author_avatar_url,
          state: fix.state,
          submittedAt: fix.submitted_at,
          reviewBody: fix,
          comments: [],
          allResolved: true, // no children yet → nothing to resolve
          resolvedCount: 0,
          totalCount: 0,
        });
      }
    } else if (fix.comment_type === "inline") {
      const key = `review-${fix.review_id}`;
      const existing = groupMap.get(key);
      if (existing) {
        existing.comments.push(fix);
        existing.totalCount++;
        if (isFixResolved(fix, resolvedIds)) existing.resolvedCount++;
        existing.allResolved = existing.resolvedCount === existing.totalCount;
      } else {
        order.push(key);
        groupMap.set(key, {
          key,
          reviewId: fix.review_id,
          author: fix.author,
          authorAvatarUrl: fix.author_avatar_url,
          state: "COMMENTED",
          submittedAt: fix.submitted_at,
          reviewBody: null,
          comments: [fix],
          allResolved: isFixResolved(fix, resolvedIds),
          resolvedCount: isFixResolved(fix, resolvedIds) ? 1 : 0,
          totalCount: 1,
        });
      }
    }
  }

  // Return in order, unresolved groups first
  const groups = order.map((k) => groupMap.get(k)!);
  groups.sort((a, b) => {
    if (a.allResolved !== b.allResolved) return a.allResolved ? 1 : -1;
    return 0;
  });
  return groups;
}

function timeAgo(dateStr: string): string {
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  const seconds = Math.floor((now - then) / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(dateStr).toLocaleDateString();
}

// --- Components ---

// --- Summary Panel ---

function ReviewSummaryPanel({
  fixes,
  resolvedIds,
  replies,
  groups,
  summary,
  summaryLoading,
  onNavigate,
  loading,
  onRefresh,
  onPull,
  onPush,
  pulling,
  pushing,
  fixingId,
}: {
  fixes: PrReviewFix[];
  resolvedIds: Set<string>;
  replies: Map<number, GhReviewComment[]>;
  groups: ReviewGroup[];
  summary: string | null;
  summaryLoading: boolean;
  onNavigate: (fixId: string) => void;
  loading: boolean;
  onRefresh: () => void;
  onPull?: () => void;
  onPush?: () => void;
  pulling: boolean;
  pushing: boolean;
  fixingId: string | null;
}) {
  // Review IDs that have inline comments — the review body itself is just a summary, not actionable
  const reviewsWithInlines = new Set(
    fixes.filter((f) => f.comment_type === "inline").map((f) => f.review_id),
  );

  // Actionable = inline comments, conversation comments, or standalone review bodies (no inline children)
  const actionable = fixes.filter(
    (f) =>
      f.comment_type === "inline" ||
      f.comment_type === "conversation" ||
      (f.comment_type === "review" && f.body.trim() && !reviewsWithInlines.has(f.review_id)),
  );

  // Single axis: resolved vs needs-attention. "Resolved" = thread resolved on GH, or state APPROVED/DISMISSED.
  const resolved = actionable.filter((f) => isFixResolved(f, resolvedIds));
  const unresolved = actionable.filter((f) => !isFixResolved(f, resolvedIds));

  // Items with thread replies that are still unresolved (active discussions)
  const underDiscussion = unresolved.filter(
    (f) => (replies.get(f.comment_id)?.length ?? 0) > 0,
  );
  const underDiscussionIds = new Set(underDiscussion.map((f) => f.id));

  // Remaining unresolved items (not already shown under discussion), grouped by file
  const remaining = unresolved.filter((f) => !underDiscussionIds.has(f.id));
  const remainingByFile = new Map<string, PrReviewFix[]>();
  for (const fix of remaining) {
    const key = fix.file_path ?? "(general)";
    const list = remainingByFile.get(key) ?? [];
    list.push(fix);
    remainingByFile.set(key, list);
  }

  // Unique reviewers with latest review state
  const reviewStates = new Map<string, string>();
  for (const g of groups) {
    if (g.reviewId != null) {
      reviewStates.set(g.author, g.state);
    }
  }
  const reviewers = [...new Set(fixes.map((f) => f.author))];

  return (
    <div className="space-y-6">
      {/* Header row */}
      <div className="flex items-center gap-2.5">
        <h3 className="text-lg font-semibold text-foreground">Summary</h3>
        {summaryLoading && (
          <span className="inline-flex items-center gap-1 text-xs text-muted-foreground/60">
            <Loader2 className="w-3 h-3 animate-spin" />
            {summary ? "Updating..." : "Generating..."}
          </span>
        )}
        <span className="text-xs text-muted-foreground">
          {resolved.length}/{actionable.length} resolved
        </span>
        <div className="flex items-center gap-1 ml-auto">
          {reviewers.map((r) => {
            const state = reviewStates.get(r);
            const ringColor = state === "APPROVED"
              ? "ring-emerald-400 dark:ring-emerald-500"
              : state === "CHANGES_REQUESTED"
                ? "ring-amber-400 dark:ring-amber-500"
                : "ring-zinc-300 dark:ring-zinc-600";
            const avatar = fixes.find((f) => f.author === r)?.author_avatar_url;
            return (
              <div key={r} title={`${r}${state ? ` (${stateColors[state]?.label ?? state})` : ""}`}>
                {avatar ? (
                  <img src={avatar} alt={r} className={`w-5 h-5 rounded-full ring-2 ${ringColor}`} />
                ) : (
                  <div className={`w-5 h-5 rounded-full ring-2 ${ringColor} bg-zinc-200 dark:bg-zinc-700 flex items-center justify-center text-[9px] font-medium text-foreground/70`}>
                    {r[0]?.toUpperCase()}
                  </div>
                )}
              </div>
            );
          })}
          <div className="flex items-center gap-0.5 ml-2">
            <button
              type="button"
              onClick={onRefresh}
              disabled={loading}
              className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors disabled:opacity-50"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} />
              {loading ? "Refreshing..." : "Refresh"}
            </button>
            {onPull && (
              <button
                type="button"
                onClick={onPull}
                disabled={pulling || !!fixingId}
                className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors disabled:opacity-50"
              >
                {pulling ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <ArrowDownToLine className="w-3.5 h-3.5" />
                )}
                {pulling ? "Pulling..." : "Pull"}
              </button>
            )}
            {onPush && (
              <button
                type="button"
                onClick={onPush}
                disabled={pushing || !!fixingId}
                className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors disabled:opacity-50"
              >
                {pushing ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <ArrowUpFromLine className="w-3.5 h-3.5" />
                )}
                {pushing ? "Pushing..." : "Push"}
              </button>
            )}
          </div>
        </div>
      </div>

      {/* AI summary */}
      {summary && (
        <div className="text-[13px] text-muted-foreground leading-[1.7]">
          <TextOutput content={summary} />
        </div>
      )}

      {/* Open items lists */}
      {(underDiscussion.length > 0 || remainingByFile.size > 0) && (
        <div className="space-y-3 pt-4 border-t border-border/50">
          {/* Under discussion */}
          {underDiscussion.length > 0 && (
            <div>
              <div className="text-xs font-medium text-foreground mb-2 flex items-center gap-1.5">
                <MessageSquare className="w-3.5 h-3.5 text-amber-500" />
                Under Discussion
                <span className="text-muted-foreground font-normal">({underDiscussion.length})</span>
              </div>
              <div className="space-y-1 pl-5">
                {underDiscussion.map((fix) => (
                  <button
                    key={fix.id}
                    type="button"
                    onClick={() => onNavigate(fix.id)}
                    className="group w-full text-left text-xs rounded-md px-2.5 py-1.5 -ml-2.5 hover:bg-muted/80 transition-colors cursor-pointer flex items-baseline gap-2"
                  >
                    <span className="w-1 h-1 rounded-full bg-amber-400 flex-shrink-0 translate-y-[3px]" />
                    <span className="text-muted-foreground">
                      {fix.file_path && (
                        <span className="font-mono text-foreground/70">{fix.file_path}{fix.line ? `:${fix.line}` : ""}</span>
                      )}
                      {fix.file_path && " — "}
                      {fix.body.replace(/```suggestion\b[^\n]*\n[\s\S]*?```/g, "[suggestion]").slice(0, 100)}
                      {fix.body.length > 100 ? "..." : ""}
                      <span className="text-muted-foreground/40 ml-1">({replies.get(fix.comment_id)?.length} {replies.get(fix.comment_id)?.length === 1 ? "reply" : "replies"})</span>
                    </span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Needs attention */}
          {remainingByFile.size > 0 && (
            <div>
              <div className="text-xs font-medium text-foreground mb-2 flex items-center gap-1.5">
                <Lightbulb className="w-3.5 h-3.5 text-blue-500" />
                Needs Attention
                <span className="text-muted-foreground font-normal">({remaining.length})</span>
              </div>
              <div className="space-y-2.5 pl-5">
                {[...remainingByFile.entries()].map(([file, items]) => (
                  <div key={file}>
                    <div className="text-[11px] font-mono text-foreground/50 mb-1">{file}</div>
                    <div className="space-y-0.5">
                      {items.map((fix) => (
                        <button
                          key={fix.id}
                          type="button"
                          onClick={() => onNavigate(fix.id)}
                          className="group w-full text-left text-xs rounded-md px-2.5 py-1.5 -ml-2.5 hover:bg-muted/80 transition-colors cursor-pointer flex items-baseline gap-2"
                        >
                          <span className="w-1 h-1 rounded-full bg-blue-400 flex-shrink-0 translate-y-[3px]" />
                          <span className="text-muted-foreground">
                            {fix.line && <span className="text-foreground/50">L{fix.line}: </span>}
                            {fix.body.replace(/```suggestion\b[^\n]*\n[\s\S]*?```/g, "[suggestion]").replace(/\n/g, " ").slice(0, 120)}
                            {fix.body.length > 120 ? "..." : ""}
                          </span>
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {unresolved.length === 0 && (
        <div className="flex items-center gap-2 text-sm text-emerald-600 dark:text-emerald-400">
          <CheckCircle2 className="w-4 h-4" />
          All review comments resolved
        </div>
      )}
    </div>
  );
}

export function PrReviewOutput({
  fixes,
  replies,
  fixingId,
  consideringId,
  considerations,
  resolvingId,
  resolvedIds,
  pushing,
  pulling,
  hasBranch,
  onFix,
  onConsider,
  onResolve,
  onUnresolve,
  onReply,
  onPush,
  onPull,
  onRefresh,
  onOpenFile,
  loading,
  isCompleted,
  error,
  stageKey: sk,
  summary,
  summaryLoading,
}: PrReviewOutputProps) {
  // When set, the target comment should expand and scroll into view
  const [navigateToId, setNavigateToId] = useState<string | null>(null);

  const handleNavigate = useCallback((fixId: string) => {
    setNavigateToId(fixId);
    // Wait for groups/cards to expand, then scroll into view and clear
    setTimeout(() => {
      const el = document.getElementById(`comment-${fixId}`);
      if (el) {
        el.scrollIntoView({ behavior: "smooth", block: "center" });
      }
      // Clear so the same item can be clicked again
      setTimeout(() => setNavigateToId(null), 600);
    }, 50);
  }, []);

  const groups = useMemo(() => buildGroups(fixes, resolvedIds), [fixes, resolvedIds]);

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
      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <ReviewSummaryPanel
          fixes={fixes}
          resolvedIds={resolvedIds}
          replies={replies}
          groups={groups}
          summary={summary}
          summaryLoading={summaryLoading}
          onNavigate={handleNavigate}
          loading={loading}
          onRefresh={onRefresh}
          onPull={!isCompleted && hasBranch ? onPull : undefined}
          onPush={!isCompleted && hasBranch ? onPush : undefined}
          pulling={pulling}
          pushing={pushing}
          fixingId={fixingId}
        />

      {/* Review groups */}
      <hr className="border-border" />
      <div className="space-y-3">
        {groups.map((group) => (
          <ReviewGroupCard
            key={group.key}
            group={group}
            replies={replies}
            fixingId={fixingId}
            consideringId={consideringId}
            considerations={considerations}
            resolvingId={resolvingId}
            resolvedIds={resolvedIds}
            navigateToId={navigateToId}
            onFix={onFix}
            onConsider={onConsider}
            onResolve={onResolve}
            onUnresolve={onUnresolve}
            onReply={onReply}
            onOpenFile={onOpenFile}
            isCompleted={isCompleted}
            stageKey={sk}
          />
        ))}
      </div>

      {isCompleted && (
        <Alert className="border-emerald-200 dark:border-emerald-500/20 bg-emerald-50 dark:bg-emerald-500/10 text-emerald-800 dark:text-emerald-300">
          <svg className="w-4 h-4 text-emerald-600 dark:text-emerald-400 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
            <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
          </svg>
          <AlertDescription className="text-emerald-800 dark:text-emerald-300">
            PR Review completed. Task marked as done.
          </AlertDescription>
        </Alert>
      )}
    </div>
  );
}

// --- Review Group (collapsible) ---

interface ReviewGroupCardProps {
  group: ReviewGroup;
  replies: Map<number, GhReviewComment[]>;
  fixingId: string | null;
  consideringId: string | null;
  considerations: Map<string, Consideration>;
  resolvingId: string | null;
  resolvedIds: Set<string>;
  navigateToId: string | null;
  onFix: (fixId: string, context?: string) => void;
  onConsider: (fixId: string) => void;
  onResolve: (fixId: string) => void;
  onUnresolve: (fixId: string) => void;
  onReply: (commentId: number, body: string) => Promise<void>;
  onOpenFile?: (filePath: string) => void;
  isCompleted: boolean;
  stageKey: string;
}

function ReviewGroupCard({
  group,
  replies,
  fixingId,
  consideringId,
  considerations,
  resolvingId,
  resolvedIds,
  navigateToId,
  onFix,
  onConsider,
  onResolve,
  onUnresolve,
  onReply,
  onOpenFile,
  isCompleted,
  stageKey: sk,
}: ReviewGroupCardProps) {
  const hasComments = group.totalCount > 0;
  const [expanded, setExpanded] = useState(!group.allResolved);

  // Collapse when resolved status arrives asynchronously (e.g. from GitHub API)
  useEffect(() => {
    if (group.allResolved) setExpanded(false);
  }, [group.allResolved]);

  // Auto-expand when a child comment is navigated to
  const groupContainsTarget = navigateToId != null && (
    group.reviewBody?.id === navigateToId ||
    group.comments.some((c) => c.id === navigateToId)
  );
  useEffect(() => {
    if (groupContainsTarget) setExpanded(true);
  }, [groupContainsTarget]);

  const stateInfo = stateColors[group.state] ?? { badge: "secondary" as const, label: group.state };

  const borderColor = group.allResolved
    ? "border-zinc-200 dark:border-zinc-700"
    : group.state === "CHANGES_REQUESTED"
      ? "border-red-200 dark:border-red-500/20"
      : "border-blue-200 dark:border-blue-500/20";

  const bgColor = group.allResolved
    ? "bg-zinc-50 dark:bg-zinc-900"
    : group.state === "CHANGES_REQUESTED"
      ? "bg-red-50/50 dark:bg-red-500/5"
      : "bg-blue-50/50 dark:bg-blue-500/5";

  return (
    <div className={`rounded-lg border transition-colors ${borderColor} ${bgColor}`}>
      {/* Group header — always visible, clickable */}
      <button
        type="button"
        onClick={() => setExpanded((e) => !e)}
        className="w-full flex items-center gap-3 p-4 text-left hover:bg-black/[0.02] dark:hover:bg-white/[0.02] transition-colors rounded-t-lg"
      >
        {/* Avatar */}
        {group.authorAvatarUrl ? (
          <img
            src={group.authorAvatarUrl}
            alt={group.author}
            className="w-7 h-7 rounded-full flex-shrink-0"
          />
        ) : (
          <div className="w-7 h-7 rounded-full bg-zinc-300 dark:bg-zinc-600 flex-shrink-0 flex items-center justify-center text-xs font-medium text-zinc-600 dark:text-zinc-400">
            {group.author.charAt(0).toUpperCase()}
          </div>
        )}

        <div className="flex-1 min-w-0 flex items-center gap-2 flex-wrap">
          <span className="text-sm font-medium text-foreground">{group.author}</span>
          <Badge variant={stateInfo.badge} className="text-[0.77rem] uppercase font-bold">
            {stateInfo.label}
          </Badge>
          {group.submittedAt && (
            <span className="text-xs text-muted-foreground">{timeAgo(group.submittedAt)}</span>
          )}
          {hasComments && (
            <span className="text-xs text-muted-foreground">
              {group.totalCount} comment{group.totalCount !== 1 ? "s" : ""}
              {group.resolvedCount > 0 && (
                <span className="text-emerald-600 dark:text-emerald-400 ml-1">
                  ({group.resolvedCount} resolved)
                </span>
              )}
            </span>
          )}
          {hasComments && group.allResolved && (
            <span className="flex items-center gap-1 text-emerald-600 dark:text-emerald-400">
              <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
              </svg>
              <span className="text-[0.77rem] font-medium uppercase">All resolved</span>
            </span>
          )}
        </div>

        {/* Expand/collapse chevron */}
        {expanded ? (
          <ChevronDown className="w-4 h-4 text-muted-foreground flex-shrink-0" />
        ) : (
          <ChevronRight className="w-4 h-4 text-muted-foreground flex-shrink-0" />
        )}
      </button>

      {/* Expanded content */}
      {expanded && (
        <div className="px-4 pb-4 pt-0 space-y-3">
          {/* Review body — rendered naked, not as a card */}
          {group.reviewBody && group.reviewBody.body.trim() && (
            <div id={`comment-${group.reviewBody.id}`} className="text-sm text-foreground [&_h1]:!text-sm [&_h1]:!font-semibold [&_h1]:!mt-3 [&_h1]:!mb-1.5 [&_h2]:!text-sm [&_h2]:!font-semibold [&_h2]:!mt-3 [&_h2]:!mb-1.5 [&_h3]:!text-sm [&_h3]:!font-medium [&_h3]:!mt-2 [&_h3]:!mb-1 [&_p]:!my-2">
              <TextOutput content={group.reviewBody.body} />
            </div>
          )}

          {/* Inline comments — rendered as collapsible cards */}
          {group.comments.map((fix) => (
            <CommentCard
              key={fix.id}
              fix={fix}
              replies={replies.get(fix.comment_id) ?? EMPTY_REPLIES}
              fixingId={fixingId}
              consideringId={consideringId}
              consideration={considerations.get(fix.id) ?? null}
              resolvingId={resolvingId}
              isGhResolved={resolvedIds.has(fix.id)}
              navigateToId={navigateToId}
              onFix={onFix}
              onConsider={onConsider}
              onResolve={onResolve}
              onUnresolve={onUnresolve}
              onReply={onReply}
              onOpenFile={onOpenFile}
              isCompleted={isCompleted}
              stageKey={sk}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// --- Suggestion Block (GitHub-style) ---

function SuggestionBlock({
  suggestion,
  diffHunk,
  line,
}: {
  suggestion: string;
  diffHunk: string | null;
  line: number | null;
}) {
  const newLines = suggestion.replace(/\n$/, "").split("\n");
  const oldLines = extractOldLines(diffHunk, newLines.length);

  return (
    <div className="my-3 rounded-md border border-border overflow-hidden">
      <div className="px-3 py-1.5 bg-zinc-100 dark:bg-zinc-800 border-b border-border text-xs text-muted-foreground font-medium">
        Suggested change
      </div>
      <div className="text-xs font-mono overflow-x-auto">
        {/* Old lines (red) */}
        {oldLines.map((ol, i) => (
          <div key={`old-${i}`} className="flex bg-red-50 dark:bg-red-500/10 border-b border-border/30">
            {line != null && (
              <span className="w-10 flex-shrink-0 text-right pr-2 py-0.5 text-muted-foreground/50 select-none border-r border-border/30">
                {line - oldLines.length + 1 + i}
              </span>
            )}
            <span className="w-5 flex-shrink-0 text-center py-0.5 text-red-500 dark:text-red-400 select-none">-</span>
            <span className="py-0.5 pr-3 text-red-800 dark:text-red-300 whitespace-pre">{ol}</span>
          </div>
        ))}
        {/* New lines (green) */}
        {newLines.map((nl, i) => (
          <div key={`new-${i}`} className="flex bg-emerald-50 dark:bg-emerald-500/10">
            {line != null && (
              <span className="w-10 flex-shrink-0 text-right pr-2 py-0.5 text-muted-foreground/50 select-none border-r border-border/30">
                {line - oldLines.length + 1 + i}
              </span>
            )}
            <span className="w-5 flex-shrink-0 text-center py-0.5 text-emerald-500 dark:text-emerald-400 select-none">+</span>
            <span className="py-0.5 pr-3 text-emerald-800 dark:text-emerald-300 whitespace-pre">{nl}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// --- Individual Comment Card ---

const CommentCard = memo(function CommentCard({
  fix,
  replies,
  fixingId,
  consideringId,
  consideration,
  resolvingId,
  isGhResolved,
  navigateToId,
  onFix,
  onConsider,
  onResolve,
  onUnresolve,
  onReply,
  onOpenFile,
  isCompleted,
  stageKey: sk,
}: {
  fix: PrReviewFix;
  replies: GhReviewComment[];
  fixingId: string | null;
  consideringId: string | null;
  consideration: Consideration | null;
  resolvingId: string | null;
  isGhResolved: boolean;
  navigateToId: string | null;
  onFix: (fixId: string, context?: string) => void;
  onConsider: (fixId: string) => void;
  onResolve: (fixId: string) => void;
  onUnresolve: (fixId: string) => void;
  onReply: (commentId: number, body: string) => Promise<void>;
  onOpenFile?: (filePath: string) => void;
  isCompleted: boolean;
  stageKey: string;
}) {
  const resolved = isFixResolved(fix) || isGhResolved;
  const isFixing = fix.id === fixingId;
  const isConsidering = fix.id === consideringId;
  const isNavigateTarget = fix.id === navigateToId;
  // Resolved items default collapsed; active fix always expanded
  const [expanded, setExpanded] = useState(!resolved || isFixing);

  // Collapse when resolved status arrives asynchronously
  useEffect(() => {
    if (resolved && !isFixing) setExpanded(false);
  }, [resolved]);

  // Auto-expand when navigated to from summary
  useEffect(() => {
    if (isNavigateTarget) setExpanded(true);
  }, [isNavigateTarget]);
  const [context, setContext] = useState("");
  const [showFixInput, setShowFixInput] = useState(false);
  const [replyText, setReplyText] = useState("");
  const [showReplyBox, setShowReplyBox] = useState(false);
  const [submittingReply, setSubmittingReply] = useState(false);

  const handleReply = useCallback(async () => {
    if (!replyText.trim()) return;
    setSubmittingReply(true);
    try {
      await onReply(fix.comment_id, replyText.trim());
      setReplyText("");
      setShowReplyBox(false);
    } finally {
      setSubmittingReply(false);
    }
  }, [fix.comment_id, replyText, onReply]);

  const streamOutput = useProcessStore(
    (s) => isFixing ? (s.stages[sk]?.streamOutput ?? EMPTY_LINES) : EMPTY_LINES,
  );

  const segments = useMemo(() => parseBodySegments(fix.body), [fix.body]);
  const hasSuggestion = segments.some((s) => s.type === "suggestion");

  // Truncate body for collapsed preview (strip suggestion blocks)
  const bodyPreviewText = fix.body.replace(/```suggestion\b[^\n]*\n[\s\S]*?```/g, "[suggestion]");
  const bodyPreview = bodyPreviewText.length > 120 ? bodyPreviewText.slice(0, 120) + "..." : bodyPreviewText;

  return (
    <div
      id={`comment-${fix.id}`}
      className={`transition-all rounded-md border bg-background overflow-hidden ${
        isNavigateTarget
          ? "border-blue-400 dark:border-blue-500 ring-2 ring-blue-200 dark:ring-blue-500/30"
          : "border-border"
      }`}
    >
      {/* Collapsible header — always visible */}
      <button
        type="button"
        onClick={() => setExpanded((e) => !e)}
        className="w-full flex items-center gap-2 text-left hover:bg-black/[0.02] dark:hover:bg-white/[0.02] transition-colors px-3 py-2"
      >
        {expanded ? (
          <ChevronDown className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />
        ) : (
          <ChevronRight className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />
        )}

        {fix.comment_type !== "review" && (
          <Badge variant="secondary" className="text-[0.77rem] uppercase font-medium flex-shrink-0">
            {fix.comment_type}
          </Badge>
        )}

        {fix.file_path && (
          onOpenFile ? (
            <span
              role="button"
              tabIndex={0}
              onClick={(e) => { e.stopPropagation(); onOpenFile(fix.file_path!); }}
              onKeyDown={(e) => { if (e.key === "Enter") { e.stopPropagation(); onOpenFile(fix.file_path!); } }}
              className="text-xs text-blue-600 dark:text-blue-400 hover:underline font-mono min-w-0 truncate cursor-pointer"
              dir="rtl"
            >
              {fix.file_path}
              {fix.line ? `:${fix.line}` : ""}
            </span>
          ) : (
            <span className="text-xs text-muted-foreground font-mono min-w-0 truncate" dir="rtl">
              {fix.file_path}
              {fix.line ? `:${fix.line}` : ""}
            </span>
          )
        )}

        {/* Reply count indicator */}
        {replies.length > 0 && (
          <span className="flex items-center gap-1 text-muted-foreground flex-shrink-0">
            <MessageSquare className="w-3 h-3" />
            <span className="text-[0.77rem]">{replies.length}</span>
          </span>
        )}

        {/* Collapsed: show body preview */}
        {!expanded && (
          <span className="text-xs text-muted-foreground truncate min-w-0">
            {bodyPreview.replace(/\n/g, " ")}
          </span>
        )}

        {isGhResolved && (
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onUnresolve(fix.id); }}
            disabled={resolvingId === fix.id}
            className="flex items-center gap-1 text-emerald-600 dark:text-emerald-400 hover:text-amber-600 dark:hover:text-amber-400 flex-shrink-0 ml-auto transition-colors"
            title="Unresolve this comment"
          >
            <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
            </svg>
            <span className="text-[0.77rem] font-medium">
              {resolvingId === fix.id ? "Unresolving..." : "Resolved"}
            </span>
          </button>
        )}

        {resolved && !isGhResolved && (
          <span className="flex items-center gap-1 text-emerald-600 dark:text-emerald-400 flex-shrink-0 ml-auto">
            <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
            </svg>
          </span>
        )}
      </button>

      {/* Expanded content */}
      {expanded && (
        <div className="px-3 pb-3 pt-1">
          {/* Body — with suggestion-aware rendering */}
          <div>
            {hasSuggestion ? (
              <>
                {segments.map((seg, i) =>
                  seg.type === "text" && seg.content.trim() ? (
                    <TextOutput key={i} content={seg.content} />
                  ) : seg.type === "suggestion" ? (
                    <SuggestionBlock
                      key={i}
                      suggestion={seg.content}
                      diffHunk={fix.diff_hunk}
                      line={fix.line}
                    />
                  ) : null,
                )}
              </>
            ) : (
              <TextOutput content={fix.body} />
            )}
          </div>

          {/* Diff hunk (hidden when suggestion is present — context is shown in the suggestion block) */}
          {fix.diff_hunk && !hasSuggestion && (
            <pre className="text-xs text-muted-foreground bg-zinc-100 dark:bg-zinc-900 border border-border rounded p-2 mt-2 overflow-x-auto font-mono whitespace-pre-wrap">
              {fix.diff_hunk}
            </pre>
          )}

          {/* Replies */}
          {replies.length > 0 && (
            <div className="mt-3 space-y-2 border-l-2 border-border/50 pl-3">
              {replies.map((reply) => (
                <ReplyBubble key={reply.id} reply={reply} />
              ))}
            </div>
          )}

          {/* AI consideration result */}
          {consideration && !isConsidering && (
            <div className={`mt-3 rounded-md border p-3 ${
              consideration.verdict === "fix"
                ? "border-blue-200 dark:border-blue-500/20 bg-blue-50/50 dark:bg-blue-500/5"
                : consideration.verdict === "dismiss"
                  ? "border-emerald-200 dark:border-emerald-500/20 bg-emerald-50/50 dark:bg-emerald-500/5"
                  : "border-amber-200 dark:border-amber-500/20 bg-amber-50/50 dark:bg-amber-500/5"
            }`}>
              <div className={`flex items-center gap-1.5 mb-1.5 ${
                consideration.verdict === "fix"
                  ? "text-blue-700 dark:text-blue-400"
                  : consideration.verdict === "dismiss"
                    ? "text-emerald-700 dark:text-emerald-400"
                    : "text-amber-700 dark:text-amber-400"
              }`}>
                <Lightbulb className="w-3.5 h-3.5" />
                <span className="text-xs font-medium">
                  {consideration.verdict === "fix" ? "Should be fixed" : consideration.verdict === "dismiss" ? "Can be dismissed" : "Needs discussion"}
                </span>
              </div>
              <div className="text-sm text-foreground">
                <TextOutput content={consideration.reasoning} />
              </div>
              {!isCompleted && !fixingId && !consideringId && (
                <div className="flex items-center gap-1 mt-2 pt-2 border-t border-border/50">
                  {consideration.verdict === "fix" && (
                    <button
                      type="button"
                      onClick={() => onFix(fix.id)}
                      className="inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium text-foreground hover:bg-black/5 dark:hover:bg-white/5 transition-colors"
                    >
                      <Wrench className="w-3.5 h-3.5" />
                      Fix
                    </button>
                  )}
                  {consideration.suggested_reply && (
                    <button
                      type="button"
                      onClick={() => { setReplyText(consideration.suggested_reply!); setShowReplyBox(true); }}
                      className="inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-black/5 dark:hover:bg-white/5 transition-colors"
                    >
                      <MessageSquare className="w-3.5 h-3.5" />
                      {consideration.verdict === "dismiss" ? "Reply & Dismiss" : "Reply"}
                    </button>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Stream output while fixing */}
          {isFixing && streamOutput && streamOutput.length > 0 && (
            <div className="mt-3 bg-zinc-50 dark:bg-zinc-900 text-zinc-600 dark:text-zinc-400 border border-border rounded-lg p-3 max-h-48 overflow-y-auto">
              <pre className="text-xs font-mono whitespace-pre-wrap">
                {streamOutput.slice(-50).join("")}
              </pre>
            </div>
          )}

          {/* Inline actions — only one mode visible at a time */}
          {!isCompleted && !isFixing && !isConsidering && !fixingId && !consideringId && (
            <div className="mt-3">
              {showReplyBox ? (
                <div className="space-y-2">
                  <Textarea
                    value={replyText}
                    onChange={(e) => setReplyText(e.target.value)}
                    placeholder="Write a reply..."
                    rows={2}
                    className="text-xs resize-none"
                    autoFocus
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                        e.preventDefault();
                        handleReply();
                      }
                      if (e.key === "Escape") {
                        setShowReplyBox(false);
                        setReplyText("");
                      }
                    }}
                  />
                  <div className="flex items-center gap-2">
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-7 px-2.5 text-xs"
                      onClick={handleReply}
                      disabled={submittingReply || !replyText.trim()}
                    >
                      {submittingReply && <Loader2 className="w-3 h-3 animate-spin" />}
                      {submittingReply ? "Sending..." : "Send"}
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-7 px-2 text-xs text-muted-foreground"
                      onClick={() => { setShowReplyBox(false); setReplyText(""); }}
                      disabled={submittingReply}
                    >
                      Cancel
                    </Button>
                  </div>
                </div>
              ) : showFixInput ? (
                <div className="flex items-center gap-2">
                  <Input
                    value={context}
                    onChange={(e) => setContext(e.target.value)}
                    placeholder="Additional context (optional)..."
                    className="text-xs h-7 flex-1"
                    autoFocus
                    onKeyDown={(e) => {
                      if (e.key === "Enter") { e.preventDefault(); onFix(fix.id, context || undefined); setShowFixInput(false); }
                      if (e.key === "Escape") { setShowFixInput(false); }
                    }}
                  />
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 px-2.5 text-xs"
                    onClick={() => { onFix(fix.id, context || undefined); setShowFixInput(false); }}
                  >
                    Go
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 px-2 text-xs text-muted-foreground"
                    onClick={() => setShowFixInput(false)}
                  >
                    Cancel
                  </Button>
                </div>
              ) : (
                <div className="flex items-center gap-1">
                  {!resolved && (
                    <>
                      <button
                        type="button"
                        onClick={() => setShowFixInput(true)}
                        className="inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium text-foreground hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
                      >
                        <Wrench className="w-3.5 h-3.5" />
                        Fix
                      </button>
                      <button
                        type="button"
                        onClick={() => onConsider(fix.id)}
                        className="inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
                      >
                        <Lightbulb className="w-3.5 h-3.5" />
                        Consider
                      </button>
                    </>
                  )}
                  {fix.comment_type === "inline" && !isGhResolved && (
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); onResolve(fix.id); }}
                      disabled={resolvingId === fix.id}
                      className="inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors disabled:opacity-50"
                    >
                      {resolvingId === fix.id ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      ) : (
                        <CheckCircle2 className="w-3.5 h-3.5" />
                      )}
                      {resolvingId === fix.id ? "Resolving..." : "Resolve"}
                    </button>
                  )}
                  {fix.comment_type === "inline" && (
                    <button
                      type="button"
                      onClick={() => setShowReplyBox(true)}
                      className="inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
                    >
                      <MessageSquare className="w-3.5 h-3.5" />
                      Reply
                    </button>
                  )}
                </div>
              )}
            </div>
          )}

          {(isFixing || isConsidering) && (
            <div className="flex items-center gap-2 mt-3 text-muted-foreground">
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
              <span className="text-xs font-medium">{isFixing ? "Fixing..." : "Evaluating..."}</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
});

// --- Reply Bubble ---

function ReplyBubble({ reply }: { reply: GhReviewComment }) {
  return (
    <div className="flex gap-2">
      {reply.user.avatar_url ? (
        <img
          src={reply.user.avatar_url}
          alt={reply.user.login}
          className="w-5 h-5 rounded-full flex-shrink-0 mt-0.5"
        />
      ) : (
        <div className="w-5 h-5 rounded-full bg-zinc-300 dark:bg-zinc-600 flex-shrink-0 mt-0.5 flex items-center justify-center text-[0.6925rem] font-medium text-zinc-600 dark:text-zinc-400">
          {reply.user.login.charAt(0).toUpperCase()}
        </div>
      )}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium text-foreground">{reply.user.login}</span>
          {reply.created_at && (
            <span className="text-[0.77rem] text-muted-foreground">{timeAgo(reply.created_at)}</span>
          )}
        </div>
        <div className="text-sm">
          <TextOutput content={reply.body} />
        </div>
      </div>
    </div>
  );
}
