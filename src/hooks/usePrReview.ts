import { useState, useEffect, useRef, useCallback } from "react";
import { useProjectStore } from "../stores/projectStore";
import { useTaskStore } from "../stores/taskStore";
import { useProcessStore } from "../stores/processStore";
import { spawnClaude } from "../lib/claude";
import {
  parsePrUrl,
  ghFetchPrReviews,
  ghFetchPrComments,
  ghFetchPrIssueComments,
  ghCommentOnPr,
  gitPush,
  hasUncommittedChanges,
  gitDiffStat,
  getChangedFiles,
  gitAddFiles,
  gitCommit,
} from "../lib/git";
import * as repo from "../lib/repositories";
import { sendNotification } from "../lib/notifications";
import type {
  Task,
  StageTemplate,
  PrReviewFix,
  ClaudeStreamEvent,
} from "../lib/types";

const POLL_INTERVAL_MS = 60_000;

export function usePrReview(stage: StageTemplate, task: Task | null) {
  const activeProject = useProjectStore((s) => s.activeProject);
  const loadExecutions = useTaskStore((s) => s.loadExecutions);
  const updateTask = useTaskStore((s) => s.updateTask);
  const appendOutput = useProcessStore((s) => s.appendOutput);
  const clearOutput = useProcessStore((s) => s.clearOutput);
  const setRunning = useProcessStore((s) => s.setRunning);
  const setStopped = useProcessStore((s) => s.setStopped);

  const [fixes, setFixes] = useState<PrReviewFix[]>([]);
  const [loading, setLoading] = useState(false);
  const [fixingId, setFixingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [executionId, setExecutionId] = useState<string | null>(null);
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const mountedRef = useRef(true);
  const fetchReviewsRef = useRef<() => Promise<void>>(() => Promise.resolve());
  const preFixFilesRef = useRef<Set<string>>(new Set());

  // Create or find execution record
  const ensureExecution = useCallback(async (): Promise<string | null> => {
    if (!activeProject || !task) return null;
    if (executionId) return executionId;

    // Check for existing execution
    const existing = await repo.getLatestExecution(
      activeProject.id,
      task.id,
      stage.id,
    );
    if (existing) {
      setExecutionId(existing.id);
      return existing.id;
    }

    // Create new execution
    const id = crypto.randomUUID();
    await repo.createStageExecution(activeProject.id, {
      id,
      task_id: task.id,
      stage_template_id: stage.id,
      attempt_number: 1,
      status: "awaiting_user",
      input_prompt: "PR Review",
      user_input: null,
      raw_output: null,
      parsed_output: null,
      user_decision: null,
      session_id: null,
      error_message: null,
      thinking_output: null,
      stage_result: null,
      stage_summary: null,
      started_at: new Date().toISOString(),
    });

    setExecutionId(id);
    await loadExecutions(activeProject.id, task.id);
    return id;
  }, [activeProject, task, stage.id, executionId, loadExecutions]);

  const fetchReviews = useCallback(async () => {
    if (!activeProject || !task?.pr_url) return;

    const parsed = parsePrUrl(task.pr_url);
    if (!parsed) {
      setError("Invalid PR URL format.");
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const execId = await ensureExecution();
      if (!execId) return;

      const [reviews, comments, issueComments] = await Promise.all([
        ghFetchPrReviews(activeProject.path, parsed.owner, parsed.repo, parsed.number),
        ghFetchPrComments(activeProject.path, parsed.owner, parsed.repo, parsed.number),
        ghFetchPrIssueComments(activeProject.path, parsed.owner, parsed.repo, parsed.number),
      ]);

      const previousFixes = await repo.listPrReviewFixes(activeProject.id, execId);
      const previousCount = previousFixes.length;

      // Normalize review-level comments (APPROVED, CHANGES_REQUESTED, etc.)
      for (const review of reviews) {
        if (!review.body?.trim()) continue; // Skip empty reviews
        await repo.upsertPrReviewFix(activeProject.id, {
          id: crypto.randomUUID(),
          execution_id: execId,
          comment_id: review.id,
          comment_type: "review",
          author: review.user.login,
          author_avatar_url: review.user.avatar_url,
          body: review.body,
          file_path: null,
          line: null,
          diff_hunk: null,
          state: review.state,
          fix_status: "pending",
          fix_commit_hash: null,
        });
      }

      // Normalize inline review comments
      for (const comment of comments) {
        await repo.upsertPrReviewFix(activeProject.id, {
          id: crypto.randomUUID(),
          execution_id: execId,
          comment_id: comment.id,
          comment_type: "inline",
          author: comment.user.login,
          author_avatar_url: comment.user.avatar_url,
          body: comment.body,
          file_path: comment.path,
          line: comment.line ?? comment.original_line,
          diff_hunk: comment.diff_hunk,
          state: "COMMENTED",
          fix_status: "pending",
          fix_commit_hash: null,
        });
      }

      // Normalize general PR conversation comments
      for (const comment of issueComments) {
        // Skip bot comments
        if (comment.user.login.endsWith("[bot]")) continue;
        await repo.upsertPrReviewFix(activeProject.id, {
          id: crypto.randomUUID(),
          execution_id: execId,
          comment_id: comment.id,
          comment_type: "conversation",
          author: comment.user.login,
          author_avatar_url: comment.user.avatar_url,
          body: comment.body,
          file_path: null,
          line: null,
          diff_hunk: null,
          state: "COMMENTED",
          fix_status: "pending",
          fix_commit_hash: null,
        });
      }

      // Reload fixes from DB
      const updatedFixes = await repo.listPrReviewFixes(activeProject.id, execId);
      const newCount = updatedFixes.length - previousCount;
      if (newCount > 0) {
        sendNotification("PR Review", `${newCount} new review comment${newCount === 1 ? "" : "s"}`);
      }
      if (mountedRef.current) {
        setFixes(updatedFixes);
      }
    } catch (err) {
      if (mountedRef.current) {
        setError(err instanceof Error ? err.message : String(err));
      }
    } finally {
      if (mountedRef.current) {
        setLoading(false);
      }
    }
  }, [activeProject, task, ensureExecution]);

  // Keep ref in sync so effects always call the latest version
  fetchReviewsRef.current = fetchReviews;

  const fixComment = useCallback(
    async (fixId: string, userContext?: string) => {
      if (!activeProject || !task) return;

      const fix = fixes.find((f) => f.id === fixId);
      if (!fix) return;

      setFixingId(fixId);
      setError(null);
      await repo.updatePrReviewFix(activeProject.id, fixId, { fix_status: "fixing" });
      setFixes((prev) =>
        prev.map((f) => (f.id === fixId ? { ...f, fix_status: "fixing" } : f)),
      );

      clearOutput(stage.id);
      setRunning(stage.id, "fixing");

      // Snapshot currently changed files before Claude modifies anything
      const preFixFiles = await getChangedFiles(activeProject.path).catch(() => []);
      preFixFilesRef.current = new Set(preFixFiles);

      try {
        let prompt = `Fix the following PR review comment.

Task: ${task.title}

Review comment by ${fix.author}:
${fix.body}`;

        if (fix.file_path) {
          prompt += `\n\nFile: ${fix.file_path}`;
        }
        if (fix.line) {
          prompt += `:${fix.line}`;
        }
        if (fix.diff_hunk) {
          prompt += `\n\nRelevant diff:\n\`\`\`\n${fix.diff_hunk}\n\`\`\``;
        }
        if (userContext) {
          prompt += `\n\nAdditional context from developer:\n${userContext}`;
        }

        prompt += `\n\nRead the relevant files, understand the issue, and make the necessary code changes to address this review comment.`;

        let resultText = "";
        await new Promise<void>((resolve) => {
          spawnClaude(
            {
              prompt,
              workingDirectory: activeProject.path,
              noSessionPersistence: true,
              outputFormat: "stream-json",
            },
            (event: ClaudeStreamEvent) => {
              switch (event.type) {
                case "started":
                  setRunning(stage.id, event.process_id);
                  break;
                case "stdout_line":
                  try {
                    const parsed = JSON.parse(event.line);
                    if (parsed.type === "assistant" && parsed.message?.content) {
                      for (const block of parsed.message.content) {
                        if (block.type === "text") {
                          appendOutput(stage.id, block.text);
                          resultText += block.text;
                        }
                      }
                    } else if (parsed.type === "result") {
                      const output = parsed.result;
                      if (output != null && output !== "") {
                        const text = typeof output === "string" ? output : JSON.stringify(output);
                        appendOutput(stage.id, text);
                        resultText += text;
                      }
                    }
                  } catch {
                    appendOutput(stage.id, event.line);
                  }
                  break;
                case "stderr_line":
                  appendOutput(stage.id, `[stderr] ${event.line}`);
                  break;
                case "completed":
                  setStopped(stage.id);
                  resolve();
                  break;
                case "error":
                  setStopped(stage.id);
                  resolve();
                  break;
              }
            },
          ).catch(() => resolve());
        });

        // Check for uncommitted changes
        const hasChanges = await hasUncommittedChanges(activeProject.path);
        if (hasChanges) {
          const diffStat = await gitDiffStat(activeProject.path).catch(() => "");

          // Generate commit message
          let commitMessage = `fix: address review comment by ${fix.author}`;
          try {
            let msgText = "";
            await new Promise<void>((resolve) => {
              spawnClaude(
                {
                  prompt: `Generate a concise git commit message for fixing a PR review comment.

Review comment by ${fix.author}:
${fix.body}

${fix.file_path ? `File: ${fix.file_path}` : ""}

Changes (git diff --stat):
${diffStat}

Return ONLY the commit message text, nothing else. No quotes, no markdown, no explanation.
Keep it under 72 characters for the first line.`,
                  workingDirectory: activeProject.path,
                  maxTurns: 1,
                  allowedTools: [],
                  outputFormat: "text",
                  noSessionPersistence: true,
                },
                (event: ClaudeStreamEvent) => {
                  if (event.type === "stdout_line") {
                    msgText += event.line + "\n";
                  } else if (event.type === "completed" || event.type === "error") {
                    resolve();
                  }
                },
              ).catch(() => resolve());
            });
            const cleaned = msgText.trim();
            if (cleaned.length > 0) commitMessage = cleaned;
          } catch {
            // Use fallback message
          }

          useProcessStore.getState().setPendingCommit({
            stageId: stage.id,
            stageName: stage.name,
            message: commitMessage,
            diffStat,
            fixId,
          });
        } else {
          // No changes — mark as fixed
          await repo.updatePrReviewFix(activeProject.id, fixId, { fix_status: "fixed" });
          setFixes((prev) =>
            prev.map((f) => (f.id === fixId ? { ...f, fix_status: "fixed" } : f)),
          );
        }

        setFixingId(null);
      } catch (err) {
        setStopped(stage.id);
        setFixingId(null);
        setError(err instanceof Error ? err.message : String(err));
        await repo.updatePrReviewFix(activeProject.id, fixId, { fix_status: "pending" });
        setFixes((prev) =>
          prev.map((f) => (f.id === fixId ? { ...f, fix_status: "pending" } : f)),
        );
      }
    },
    [activeProject, task, fixes, stage.id, stage.name, clearOutput, setRunning, setStopped, appendOutput],
  );

  const commitFix = useCallback(
    async (fixId: string, commitMessage: string) => {
      if (!activeProject) return;

      try {
        // Stage only files changed by the fix, not pre-existing changes
        const allChanged = await getChangedFiles(activeProject.path);
        const fixFiles = allChanged.filter((f) => !preFixFilesRef.current.has(f));
        if (fixFiles.length > 0) {
          await gitAddFiles(activeProject.path, fixFiles);
        } else {
          // Fallback: if we can't determine which files are new, stage all
          const { gitAdd } = await import("../lib/git");
          await gitAdd(activeProject.path);
        }
        const result = await gitCommit(activeProject.path, commitMessage);
        const hashMatch = result.match(/\[[\w/.-]+\s+([a-f0-9]+)\]/);
        const shortHash = hashMatch?.[1] ?? result.slice(0, 7);

        await repo.updatePrReviewFix(activeProject.id, fixId, {
          fix_status: "fixed",
          fix_commit_hash: shortHash,
        });
        setFixes((prev) =>
          prev.map((f) =>
            f.id === fixId ? { ...f, fix_status: "fixed", fix_commit_hash: shortHash } : f,
          ),
        );
        useProcessStore.getState().clearPendingCommit();
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
    },
    [activeProject],
  );

  const skipFix = useCallback(
    async (fixId: string) => {
      if (!activeProject) return;
      await repo.updatePrReviewFix(activeProject.id, fixId, { fix_status: "skipped" });
      setFixes((prev) =>
        prev.map((f) => (f.id === fixId ? { ...f, fix_status: "skipped" } : f)),
      );
    },
    [activeProject],
  );

  const skipFixCommit = useCallback(
    async (fixId: string) => {
      if (!activeProject) return;
      await repo.updatePrReviewFix(activeProject.id, fixId, { fix_status: "fixed" });
      setFixes((prev) =>
        prev.map((f) => (f.id === fixId ? { ...f, fix_status: "fixed" } : f)),
      );
      useProcessStore.getState().clearPendingCommit();
    },
    [activeProject],
  );

  const markDone = useCallback(async () => {
    if (!activeProject || !task) return;
    setError(null);

    try {
      // Push branch
      if (task.branch_name) {
        await gitPush(activeProject.path, task.branch_name);
      }

      // Build summary
      const fixed = fixes.filter((f) => f.fix_status === "fixed");
      const skipped = fixes.filter((f) => f.fix_status === "skipped");
      const pending = fixes.filter((f) => f.fix_status === "pending");

      const summaryLines: string[] = [
        `## PR Review Summary`,
        ``,
        `- **${fixed.length}** comment(s) fixed`,
        `- **${skipped.length}** comment(s) skipped`,
        `- **${pending.length}** comment(s) pending`,
      ];

      if (fixed.length > 0) {
        summaryLines.push("", "### Fixed");
        for (const f of fixed) {
          const hash = f.fix_commit_hash ? ` (${f.fix_commit_hash})` : "";
          summaryLines.push(`- ${f.author}: ${f.body.slice(0, 80)}${f.body.length > 80 ? "..." : ""}${hash}`);
        }
      }

      const summaryText = summaryLines.join("\n");

      // Post summary comment on PR
      const parsed = parsePrUrl(task.pr_url!);
      if (parsed) {
        try {
          await ghCommentOnPr(activeProject.path, parsed.owner, parsed.repo, parsed.number, summaryText);
        } catch {
          // Non-critical — continue
        }
      }

      // Update execution with summary
      if (executionId) {
        await repo.updateStageExecution(activeProject.id, executionId, {
          status: "approved",
          raw_output: summaryText,
          parsed_output: summaryText,
          stage_result: summaryText,
          stage_summary: `${fixed.length} fixed, ${skipped.length} skipped, ${pending.length} pending`,
          completed_at: new Date().toISOString(),
        });
      }

      // Mark task as completed
      await updateTask(activeProject.id, task.id, { status: "completed" });
      if (task.id) {
        await loadExecutions(activeProject.id, task.id);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [activeProject, task, fixes, executionId, updateTask, loadExecutions]);

  // Auto-fetch on mount (only for pr_review stages)
  useEffect(() => {
    mountedRef.current = true;
    if (stage.output_format === "pr_review" && task?.pr_url && activeProject && task.status !== "completed") {
      fetchReviewsRef.current();
    }
    return () => {
      mountedRef.current = false;
    };
  }, [task?.id, task?.pr_url, activeProject?.id, stage.output_format]);

  // Polling (only for pr_review stages)
  useEffect(() => {
    if (stage.output_format !== "pr_review") return;
    if (!task?.pr_url || !activeProject || task.status === "completed") return;

    pollingRef.current = setInterval(() => {
      if (fixingId) return; // Don't poll while fixing
      fetchReviewsRef.current();
    }, POLL_INTERVAL_MS);

    return () => {
      if (pollingRef.current) {
        clearInterval(pollingRef.current);
        pollingRef.current = null;
      }
    };
  }, [task?.id, task?.pr_url, activeProject?.id, fixingId, task?.status]);

  return {
    fixes,
    loading,
    fixingId,
    error,
    fetchReviews,
    fixComment,
    commitFix,
    skipFix,
    skipFixCommit,
    markDone,
  };
}
