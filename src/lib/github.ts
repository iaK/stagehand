import { invoke } from "@tauri-apps/api/core";

/**
 * Run `gh` CLI without needing a specific project working directory.
 * Uses /tmp as a neutral cwd since search/api commands don't need a repo.
 */
async function runGhGlobal(...args: string[]): Promise<string> {
  return invoke<string>("run_gh_command", {
    args,
    workingDirectory: "/tmp",
  });
}

export interface PendingPr {
  id: string;
  number: number;
  title: string;
  url: string;
  repository: { nameWithOwner: string };
  author: { login: string };
  createdAt: string;
  updatedAt: string;
  commentsCount: number;
  isDraft: boolean;
}

export async function ghSearchPrsNeedingReview(): Promise<PendingPr[]> {
  const raw = await runGhGlobal(
    "search",
    "prs",
    "--review-requested=@me",
    "--state=open",
    "--json",
    "id,number,title,repository,author,updatedAt,url,createdAt,commentsCount,isDraft",
    "--limit",
    "50",
  );
  return JSON.parse(raw);
}

export async function ghGetCurrentUser(): Promise<string> {
  const raw = await runGhGlobal("api", "/user", "--jq", ".login");
  return raw.trim();
}

export interface GhNotification {
  id: string;
  reason: string;
  unread: boolean;
  updated_at: string;
  subject: {
    title: string;
    url: string | null;
    type: string;
  };
  repository: {
    full_name: string;
  };
}

/** Fetch unread notifications filtered to pull_request type. */
export async function ghFetchPrNotifications(): Promise<GhNotification[]> {
  const raw = await runGhGlobal(
    "api",
    "/notifications",
    "--jq",
    '[.[] | select(.subject.type == "PullRequest")]',
  );
  const parsed = JSON.parse(raw);
  return Array.isArray(parsed) ? parsed : [];
}
