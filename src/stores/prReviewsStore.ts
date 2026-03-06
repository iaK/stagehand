import { create } from "zustand";
import {
  ghSearchPrsNeedingReview,
  ghFetchPrNotifications,
  type PendingPr,
  type GhNotification,
} from "../lib/github";
import { sendNotification } from "../lib/notifications";
import { logger } from "../lib/logger";
import { useProjectStore } from "./projectStore";
import { useTaskStore } from "./taskStore";

const POLL_INTERVAL_MS = 60_000;

interface PrReviewsState {
  prs: PendingPr[];
  notifications: GhNotification[];
  loading: boolean;
  error: string | null;
  lastChecked: number | null;
  open: boolean;

  /** Set of PR URLs we've already notified about */
  seenPrUrls: Set<string>;
  /** Notification IDs we've already notified about */
  seenNotificationIds: Set<string>;

  fetch: () => Promise<void>;
  startPolling: () => void;
  stopPolling: () => void;
  setOpen: (v: boolean) => void;
  toggle: () => void;
}

let pollTimer: ReturnType<typeof setInterval> | null = null;

export const usePrReviewsStore = create<PrReviewsState>((set, get) => ({
  prs: [],
  notifications: [],
  loading: false,
  error: null,
  lastChecked: null,
  open: false,
  seenPrUrls: new Set(),
  seenNotificationIds: new Set(),

  async fetch() {
    set({ loading: true, error: null });
    try {
      const [prs, notifications] = await Promise.all([
        ghSearchPrsNeedingReview(),
        ghFetchPrNotifications(),
      ]);

      const { seenPrUrls, seenNotificationIds } = get();
      const isFirstFetch = get().lastChecked === null;

      // Notify about new PRs requesting review (skip first fetch to avoid spam)
      if (!isFirstFetch) {
        for (const pr of prs) {
          if (!seenPrUrls.has(pr.url)) {
            sendNotification(
              "PR Review Requested",
              `${pr.repository.nameWithOwner}#${pr.number}: ${pr.title}`,
              "info",
            );
          }
        }

        // Notify about new unread PR notifications (comments, reviews, etc.)
        for (const n of notifications) {
          if (n.unread && !seenNotificationIds.has(n.id)) {
            sendNotification(
              `PR ${n.reason === "review_requested" ? "Review Requested" : n.reason === "comment" ? "New Comment" : n.reason === "mention" ? "Mentioned" : "Update"}`,
              `${n.repository.full_name}: ${n.subject.title}`,
              "info",
            );
          }
        }
      }

      // Update seen sets
      const newSeenUrls = new Set(prs.map((pr) => pr.url));
      const newSeenNotifIds = new Set(notifications.filter((n) => n.unread).map((n) => n.id));

      set({
        prs,
        notifications,
        loading: false,
        lastChecked: Date.now(),
        seenPrUrls: newSeenUrls,
        seenNotificationIds: newSeenNotifIds,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error("Failed to fetch PR reviews:", msg);
      set({ loading: false, error: msg });
    }
  },

  startPolling() {
    if (pollTimer) return;
    // Initial fetch
    get().fetch();
    pollTimer = setInterval(() => {
      get().fetch();
    }, POLL_INTERVAL_MS);
  },

  stopPolling() {
    if (pollTimer) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
  },

  setOpen(v) {
    set({ open: v });
    if (v) get().fetch();
  },

  toggle() {
    const next = !get().open;
    set({ open: next });
    if (next) get().fetch();
  },
}));

// Close the panel when user switches project or task
let prevProjectId: string | undefined;
let prevTaskId: string | undefined;
useProjectStore.subscribe((s) => {
  const id = s.activeProject?.id;
  if (id !== prevProjectId) { prevProjectId = id; usePrReviewsStore.getState().setOpen(false); }
});
useTaskStore.subscribe((s) => {
  const id = s.activeTask?.id;
  if (id !== prevTaskId) { prevTaskId = id; usePrReviewsStore.getState().setOpen(false); }
});
