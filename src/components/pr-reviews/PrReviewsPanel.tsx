import { usePrReviewsStore } from "../../stores/prReviewsStore";
import { open } from "@tauri-apps/plugin-shell";
import {
  Loader2,
  RefreshCw,
  ExternalLink,
  MessageSquare,
  GitPullRequest,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip";
import type { PendingPr } from "../../lib/github";

function timeAgo(dateStr: string): string {
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  const diffMs = now - then;
  const mins = Math.floor(diffMs / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return `${Math.floor(days / 30)}mo ago`;
}

function PrRow({ pr }: { pr: PendingPr }) {
  return (
    <button
      onClick={() => open(pr.url)}
      className="w-full text-left px-5 py-3.5 hover:bg-accent/50 transition-colors border-b border-border group"
    >
      <div className="flex items-start gap-3">
        <GitPullRequest className="w-4 h-4 mt-0.5 shrink-0 text-muted-foreground" />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground font-mono">
              #{pr.number}
            </span>
            {pr.isDraft && (
              <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[0.77rem] font-medium bg-muted text-muted-foreground">
                Draft
              </span>
            )}
          </div>
          <p className="text-sm font-medium mt-0.5">
            {pr.title}
          </p>
          <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground">
            <span>{pr.author.login}</span>
            <span className="flex items-center gap-1">
              <MessageSquare className="w-3 h-3" />
              {pr.commentsCount}
            </span>
            <span>updated {timeAgo(pr.updatedAt)}</span>
          </div>
        </div>
        <ExternalLink className="w-3.5 h-3.5 shrink-0 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity mt-1" />
      </div>
    </button>
  );
}

export function PrReviewsPanel() {
  const prs = usePrReviewsStore((s) => s.prs);
  const loading = usePrReviewsStore((s) => s.loading);
  const error = usePrReviewsStore((s) => s.error);
  const lastChecked = usePrReviewsStore((s) => s.lastChecked);
  const fetch = usePrReviewsStore((s) => s.fetch);

  // Group PRs by repository
  const grouped = prs.reduce<Record<string, PendingPr[]>>((acc, pr) => {
    const repo = pr.repository.nameWithOwner;
    (acc[repo] ??= []).push(pr);
    return acc;
  }, {});

  const repoNames = Object.keys(grouped).sort();

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between h-[57px] px-5 border-b border-border shrink-0">
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-semibold">PR Reviews</h2>
          {prs.length > 0 && (
            <span className="inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full text-[0.77rem] font-medium bg-primary text-primary-foreground">
              {prs.length}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {lastChecked && (
            <span className="text-[0.846rem] text-muted-foreground/60">
              Updated {timeAgo(new Date(lastChecked).toISOString())}
            </span>
          )}
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon-xs"
                onClick={() => fetch()}
                disabled={loading}
              >
                {loading ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <RefreshCw className="w-3.5 h-3.5" />
                )}
              </Button>
            </TooltipTrigger>
            <TooltipContent>Refresh</TooltipContent>
          </Tooltip>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        {error && (
          <div className="px-5 py-3 text-xs text-destructive bg-destructive/10 border-b border-border">
            {error.includes("gh") ? (
              <>
                <p className="font-medium">GitHub CLI not authenticated</p>
                <p className="mt-1 text-muted-foreground">
                  Run <code className="px-1 py-0.5 rounded bg-muted font-mono">gh auth login</code> in your terminal.
                </p>
              </>
            ) : (
              <p>{error}</p>
            )}
          </div>
        )}

        {!loading && !error && prs.length === 0 && lastChecked && (
          <div className="flex flex-col items-center justify-center h-full text-center px-4">
            <GitPullRequest className="w-8 h-8 text-muted-foreground/40 mb-3" />
            <p className="text-sm text-muted-foreground">No PRs need your review</p>
            <p className="text-xs text-muted-foreground/60 mt-1">
              Checking every minute
            </p>
          </div>
        )}

        {loading && prs.length === 0 && (
          <div className="flex items-center justify-center h-full">
            <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
          </div>
        )}

        {repoNames.map((repo) => (
          <div key={repo}>
            <div className="px-5 py-2 text-xs font-medium text-muted-foreground bg-background border-b border-border sticky top-0">
              {repo}
            </div>
            {grouped[repo].map((pr) => (
              <PrRow key={pr.url} pr={pr} />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
