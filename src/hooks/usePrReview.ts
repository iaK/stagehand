import { useState, useEffect, useRef, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useProjectStore } from "../stores/projectStore";
import { useTaskStore } from "../stores/taskStore";
import { useGitHubStore } from "../stores/githubStore";
import { useProcessStore, stageKey } from "../stores/processStore";
import { spawnAgent } from "../lib/agent";
import { parseAgentStreamLine } from "../lib/agentParsers";
import {
  parsePrUrl,
  ghFetchPrReviews,
  ghFetchPrComments,
  ghFetchPrIssueComments,
  ghFetchPrState,
  ghFetchReviewThreads,
  ghResolveReviewThread,
  ghUnresolveReviewThread,
  ghCommentOnPr,
  ghReplyToReviewComment,
  gitPush,
  gitPull,
  hasUncommittedChanges,
  gitDiffStat,
  getChangedFiles,
  gitAddFiles,
  gitCommit,
  gitDiffShortStatBranch,
} from "../lib/git";
import type { GhReviewComment } from "../lib/git";
import { getTaskWorkingDir, cleanupTaskWorktree } from "../lib/worktree";
import * as repo from "../lib/repositories";
import { sendNotification } from "../lib/notifications";
import { loadConventions } from "../lib/conventions";
import { PR_REVIEW_POLL_MS } from "../lib/constants";
import type {
  Task,
  TaskStageInstance,
  PrReviewFix,
  AgentStreamEvent,
} from "../lib/types";

export function usePrReview(stage: TaskStageInstance, task: Task | null) {
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
  const [resolvingId, setResolvingId] = useState<string | null>(null);
  const [resolvedIds, setResolvedIds] = useState<Set<string>>(new Set());
  const [replies, setReplies] = useState<Map<number, GhReviewComment[]>>(new Map());
  const [consideringId, setConsideringId] = useState<string | null>(null);
  const [considerations, setConsiderations] = useState<Map<string, string>>(new Map());
  const [pushing, setPushing] = useState(false);
  const [pulling, setPulling] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [executionId, setExecutionId] = useState<string | null>(null);
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const mountedRef = useRef(true);
  const isFetchingRef = useRef(false);
  const fetchReviewsRef = useRef<() => Promise<void>>(() => Promise.resolve());
  const preFixFilesRef = useRef<Set<string>>(new Set());
  const hasCachedFixesRef = useRef(false);

  /** Build MCP config + system prompt with pipeline context for agent calls. */
  const buildAgentContext = useCallback(async (): Promise<{
    mcpConfig?: string;
    systemPrompt: string;
  }> => {
    if (!activeProject || !task) return { systemPrompt: "" };

    const parts: string[] = [];

    // 1. Completed stage summaries
    try {
      const summaries = await repo.getApprovedStageSummaries(activeProject.id, task.id);
      if (summaries.length > 0) {
        const lines = summaries.map((s) => `### ${s.stage_name}\n${s.stage_summary}`).join("\n\n");
        parts.push(
          `## Completed Pipeline Stages\nThe following stages have been completed for this task. Use the \`get_stage_output\` MCP tool to retrieve the full output of any stage if you need more detail.\n\n${lines}`,
        );
      }
    } catch {
      // Non-critical
    }

    // 2. Project conventions
    try {
      const conventions = await loadConventions(activeProject.id);
      if (conventions.fullRules) {
        parts.push(`## Project Conventions\n${conventions.fullRules}`);
      }
    } catch {
      // Non-critical
    }

    // 3. MCP config
    let mcpConfig: string | undefined;
    try {
      const mcpServerPath = await invoke<string>("get_mcp_server_path");
      const stagehandDir = await invoke<string>("get_stagehand_dir");
      const dbPath = `${stagehandDir}/data/${activeProject.id}.db`;
      mcpConfig = JSON.stringify({
        mcpServers: {
          "stagehand-context": {
            command: "node",
            args: [mcpServerPath],
            env: {
              STAGEHAND_DB_PATH: dbPath,
              STAGEHAND_TASK_ID: task.id,
            },
          },
        },
      });
      parts.push(
        "You have access to `list_completed_stages`, `get_stage_output`, and `get_task_title` tools to retrieve data from prior pipeline stages on demand.",
      );
    } catch {
      // Graceful degradation
    }

    return { mcpConfig, systemPrompt: parts.join("\n\n") };
  }, [activeProject, task]);

  /** Build prompt context shared between fix/consider: task description, thread replies, sibling comments. */
  const buildCommentContext = (fix: PrReviewFix): string => {
    const sections: string[] = [];

    // Thread replies
    const commentReplies = replies.get(fix.comment_id);
    if (commentReplies && commentReplies.length > 0) {
      const replyLines = commentReplies.map((r) => `- **${r.user.login}**: ${r.body}`).join("\n");
      sections.push(`Thread replies:\n${replyLines}`);
    }

    // Other comments in the same review
    if (fix.review_id != null) {
      const siblings = fixes.filter(
        (f) => f.review_id === fix.review_id && f.id !== fix.id && f.comment_type === "inline",
      );
      if (siblings.length > 0) {
        const siblingLines = siblings
          .map((s) => `- ${s.file_path ?? ""}${s.line ? `:${s.line}` : ""}: ${s.body.slice(0, 120)}`)
          .join("\n");
        sections.push(`Other comments in this review:\n${siblingLines}`);
      }
    }

    return sections.join("\n\n");
  };

  // Create or find execution record
  const ensureExecution = useCallback(async (): Promise<string | null> => {
    if (!activeProject || !task) return null;
    if (executionId) return executionId;

    // Check for existing execution
    const existing = await repo.getLatestExecution(
      activeProject.id,
      task.id,
      stage.task_stage_id,
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
      task_stage_id: stage.task_stage_id,
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
      input_tokens: null,
      output_tokens: null,
      cache_creation_input_tokens: null,
      cache_read_input_tokens: null,
      total_cost_usd: null,
      duration_ms: null,
      num_turns: null,
      started_at: new Date().toISOString(),
    });

    setExecutionId(id);
    await loadExecutions(activeProject.id, task.id);
    return id;
  }, [activeProject, task, stage.task_stage_id, executionId, loadExecutions]);

  const fetchReviews = useCallback(async () => {
    if (isFetchingRef.current) return;
    if (!activeProject || !task?.pr_url) return;

    const parsed = parsePrUrl(task.pr_url);
    if (!parsed) {
      setError("Invalid PR URL format.");
      return;
    }

    isFetchingRef.current = true;
    // Only show full loading spinner if we have no cached fixes to display
    if (!hasCachedFixesRef.current) setLoading(true);
    setError(null);

    try {
      const execId = await ensureExecution();
      if (!execId) return;

      // Check if PR has been merged or closed — auto-complete the task
      const prState = await ghFetchPrState(activeProject.path, parsed.owner, parsed.repo, parsed.number);
      if (prState.state === "closed" || prState.merged) {
        const label = prState.merged ? "merged" : "closed";

        // Update execution
        await repo.updateStageExecution(activeProject.id, execId, {
          status: "approved",
          raw_output: `PR ${label}`,
          parsed_output: `PR ${label}`,
          stage_result: `PR ${label}`,
          stage_summary: `PR ${label}`,
          completed_at: new Date().toISOString(),
        });

        // Persist diff stats before cleanup so they survive after merge
        try {
          const defaultBranch = useGitHubStore.getState().defaultBranch;
          if (defaultBranch) {
            const workDir = getTaskWorkingDir(task, activeProject.path);
            const stats = await gitDiffShortStatBranch(workDir, defaultBranch);
            await repo.updateTask(activeProject.id, task.id, {
              diff_insertions: stats.insertions,
              diff_deletions: stats.deletions,
            });
          }
        } catch {
          // Non-critical — stats may already be persisted from earlier
        }

        // Clean up worktree; delete branch only after merge (not close — a closed PR may be reopened)
        await cleanupTaskWorktree(activeProject.path, task, {
          deleteBranch: !!prState.merged,
          defaultBranch: useGitHubStore.getState().defaultBranch ?? undefined,
        });

        // Mark task as completed
        await updateTask(activeProject.id, task.id, { status: "completed" });
        await loadExecutions(activeProject.id, task.id);
        sendNotification("Task completed", `PR was ${label}`, "success");
        if (mountedRef.current) {
          setLoading(false);
        }
        return;
      }

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
          review_id: review.id,
          author: review.user.login,
          author_avatar_url: review.user.avatar_url,
          body: review.body,
          file_path: null,
          line: null,
          diff_hunk: null,
          state: review.state,
          fix_status: "pending",
          fix_commit_hash: null,
          submitted_at: review.submitted_at,
        });
      }

      // Separate root inline comments from replies
      const rootComments: GhReviewComment[] = [];
      const replyMap = new Map<number, GhReviewComment[]>();
      for (const comment of comments) {
        if (comment.in_reply_to_id) {
          const list = replyMap.get(comment.in_reply_to_id) ?? [];
          list.push(comment);
          replyMap.set(comment.in_reply_to_id, list);
        } else {
          rootComments.push(comment);
        }
      }

      // Also create placeholder review records for reviews without body
      // so inline comments can group under them
      for (const review of reviews) {
        if (review.body?.trim()) continue; // Already created above
        const hasInlineComments = rootComments.some(
          (c) => c.pull_request_review_id === review.id,
        );
        if (!hasInlineComments) continue;
        await repo.upsertPrReviewFix(activeProject.id, {
          id: crypto.randomUUID(),
          execution_id: execId,
          comment_id: review.id,
          comment_type: "review",
          review_id: review.id,
          author: review.user.login,
          author_avatar_url: review.user.avatar_url,
          body: "",
          file_path: null,
          line: null,
          diff_hunk: null,
          state: review.state,
          fix_status: "skipped",
          fix_commit_hash: null,
          submitted_at: review.submitted_at,
        });
      }

      // Normalize root inline review comments (replies are shown from GitHub directly)
      for (const comment of rootComments) {
        await repo.upsertPrReviewFix(activeProject.id, {
          id: crypto.randomUUID(),
          execution_id: execId,
          comment_id: comment.id,
          comment_type: "inline",
          review_id: comment.pull_request_review_id,
          author: comment.user.login,
          author_avatar_url: comment.user.avatar_url,
          body: comment.body,
          file_path: comment.path,
          line: comment.line ?? comment.original_line,
          diff_hunk: comment.diff_hunk,
          state: "COMMENTED",
          fix_status: "pending",
          fix_commit_hash: null,
          submitted_at: comment.created_at,
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
          review_id: null,
          author: comment.user.login,
          author_avatar_url: comment.user.avatar_url,
          body: comment.body,
          file_path: null,
          line: null,
          diff_hunk: null,
          state: "COMMENTED",
          fix_status: "pending",
          fix_commit_hash: null,
          submitted_at: comment.created_at,
        });
      }

      // Fetch resolved thread status from GitHub and sync to local fixes
      try {
        const threads = await ghFetchReviewThreads(
          activeProject.path, parsed.owner, parsed.repo, parsed.number,
        );
        const resolvedCommentIds = new Set<number>();
        for (const thread of threads) {
          if (thread.isResolved) {
            for (const cid of thread.commentDatabaseIds) {
              resolvedCommentIds.add(cid);
            }
          }
        }

        // Reload fixes before checking resolved status
        const currentFixes = await repo.listPrReviewFixes(activeProject.id, execId);
        const newResolvedFixIds = new Set<string>();
        for (const fix of currentFixes) {
          if (fix.comment_type === "inline" && resolvedCommentIds.has(fix.comment_id)) {
            newResolvedFixIds.add(fix.id);
          }
        }
        if (mountedRef.current) {
          setResolvedIds((prev) => {
            const next = new Set(prev);
            for (const id of newResolvedFixIds) next.add(id);
            return next;
          });
        }
      } catch {
        // Non-critical — resolved status is cosmetic
      }

      // Reload fixes from DB
      const updatedFixes = await repo.listPrReviewFixes(activeProject.id, execId);
      const newCount = updatedFixes.length - previousCount;
      if (newCount > 0) {
        sendNotification("PR Review", `${newCount} new review comment${newCount === 1 ? "" : "s"}`, "info", { projectId: activeProject.id, taskId: task.id });
      }
      if (mountedRef.current) {
        hasCachedFixesRef.current = updatedFixes.length > 0;
        setFixes(updatedFixes);
        setReplies(replyMap);
      }
    } catch (err) {
      if (mountedRef.current) {
        setError(err instanceof Error ? err.message : String(err));
      }
    } finally {
      isFetchingRef.current = false;
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

      const sk = stageKey(task.id, stage.task_stage_id);
      clearOutput(sk);
      setRunning(sk, "fixing");

      const workDir = getTaskWorkingDir(task, activeProject.path);

      // Resolve effective agent: per-stage override → project default → "claude"
      const agentSetting = await repo.getProjectSetting(activeProject.id, "default_agent");
      const effectiveAgent = stage.agent_override ?? stage.agent ?? agentSetting ?? "claude";

      // Snapshot currently changed files before the agent modifies anything
      const preFixFiles = await getChangedFiles(workDir).catch(() => []);
      preFixFilesRef.current = new Set(preFixFiles);

      try {
        const { mcpConfig, systemPrompt } = await buildAgentContext();

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

        const extraContext = buildCommentContext(fix);
        if (extraContext) {
          prompt += `\n\n${extraContext}`;
        }

        // Include AI consideration if available
        const considerationText = considerations.get(fixId);
        if (considerationText) {
          prompt += `\n\nAI evaluation of this comment:\n${considerationText}`;
        }

        if (userContext) {
          prompt += `\n\nAdditional context from developer:\n${userContext}`;
        }

        prompt += `\n\nRead the relevant files, understand the issue, and make the necessary code changes to address this review comment.`;

        let resultText = "";
        await new Promise<void>((resolve) => {
          spawnAgent(
            {
              prompt,
              agent: effectiveAgent,
              workingDirectory: workDir,
              noSessionPersistence: true,
              outputFormat: "stream-json",
              appendSystemPrompt: systemPrompt || undefined,
              mcpConfig,
            },
            (event: AgentStreamEvent) => {
              switch (event.type) {
                case "started":
                  setRunning(sk, event.process_id);
                  break;
                case "stdout_line": {
                  const parsed = parseAgentStreamLine(event.line);
                  if (parsed?.text) {
                    appendOutput(sk, parsed.text);
                    resultText += parsed.text;
                  }
                  // Non-JSON lines are CLI UI noise — skip
                  break;
                }
                case "stderr_line":
                  appendOutput(sk, `[stderr] ${event.line}`);
                  break;
                case "completed":
                  setStopped(sk);
                  resolve();
                  break;
                case "error":
                  setStopped(sk);
                  resolve();
                  break;
              }
            },
          ).catch(() => resolve());
        });

        // Check for uncommitted changes
        const hasChanges = await hasUncommittedChanges(workDir);
        if (hasChanges) {
          const diffStat = await gitDiffStat(workDir).catch(() => "");

          // Generate commit message
          let commitMessage = `fix: address review comment by ${fix.author}`;
          try {
            let msgText = "";
            await new Promise<void>((resolve) => {
              spawnAgent(
                {
                  agent: effectiveAgent,
                  prompt: `Generate a concise git commit message for fixing a PR review comment.

Review comment by ${fix.author}:
${fix.body}

${fix.file_path ? `File: ${fix.file_path}` : ""}

Changes (git diff --stat):
${diffStat}

Return ONLY the commit message text, nothing else. No quotes, no markdown, no explanation.
Keep it under 72 characters for the first line.`,
                  workingDirectory: workDir,
                  maxTurns: 1,
                  allowedTools: [],
                  outputFormat: "stream-json",
                  noSessionPersistence: true,
                },
                (event: AgentStreamEvent) => {
                  switch (event.type) {
                    case "stdout_line": {
                      const parsed = parseAgentStreamLine(event.line);
                      if (parsed?.text) {
                        msgText += parsed.text;
                      }
                      break;
                    }
                    case "completed":
                    case "error":
                      resolve();
                      break;
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
            stageId: stage.task_stage_id,
            taskId: task!.id,
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
        setStopped(sk);
        setFixingId(null);
        setError(err instanceof Error ? err.message : String(err));
        await repo.updatePrReviewFix(activeProject.id, fixId, { fix_status: "pending" });
        setFixes((prev) =>
          prev.map((f) => (f.id === fixId ? { ...f, fix_status: "pending" } : f)),
        );
      }
    },
    [activeProject, task, fixes, replies, considerations, stage.task_stage_id, stage.name, stage.agent_override, stage.agent, buildAgentContext, clearOutput, setRunning, setStopped, appendOutput],
  );

  const commitFix = useCallback(
    async (fixId: string, commitMessage: string) => {
      if (!activeProject || !task) return;

      const workDir = getTaskWorkingDir(task, activeProject.path);

      try {
        // Stage only files changed by the fix, not pre-existing changes
        const allChanged = await getChangedFiles(workDir);
        const fixFiles = allChanged.filter((f) => !preFixFilesRef.current.has(f));
        if (fixFiles.length > 0) {
          await gitAddFiles(workDir, fixFiles);
        } else {
          // Fallback: if we can't determine which files are new, stage all
          const { gitAdd } = await import("../lib/git");
          await gitAdd(workDir);
        }
        const result = await gitCommit(workDir, commitMessage);
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
        sendNotification("Fix committed", shortHash, "success", { projectId: activeProject.id, taskId: task.id });
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
    },
    [activeProject, task],
  );

  const skipFixCommit = useCallback(
    async (fixId: string) => {
      if (!activeProject) return;
      await repo.updatePrReviewFix(activeProject.id, fixId, { fix_status: "fixed" });
      setFixes((prev) =>
        prev.map((f) => (f.id === fixId ? { ...f, fix_status: "fixed" } : f)),
      );
      useProcessStore.getState().clearPendingCommit();
      sendNotification("Fix commit skipped", undefined, "info", { projectId: activeProject.id, taskId: task?.id });
    },
    [activeProject, task],
  );

  const considerComment = useCallback(
    async (fixId: string) => {
      if (!activeProject || !task) return;

      const fix = fixes.find((f) => f.id === fixId);
      if (!fix) return;

      setConsideringId(fixId);
      setError(null);

      const sk = stageKey(task.id, stage.task_stage_id);
      clearOutput(sk);
      setRunning(sk, "considering");

      const workDir = getTaskWorkingDir(task, activeProject.path);
      const agentSetting = await repo.getProjectSetting(activeProject.id, "default_agent");
      const effectiveAgent = stage.agent_override ?? stage.agent ?? agentSetting ?? "claude";

      try {
        const { mcpConfig, systemPrompt } = await buildAgentContext();

        let prompt = `Evaluate the following PR review comment and recommend whether it should be fixed or can be safely dismissed.

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

        const extraContext = buildCommentContext(fix);
        if (extraContext) {
          prompt += `\n\n${extraContext}`;
        }

        prompt += `

Read the relevant file(s) and understand the context. Then give your recommendation:

1. **Verdict**: Should this be fixed? (YES / NO / PARTIAL)
2. **Reasoning**: Why or why not? Is the reviewer's point valid?
3. **Effort**: How complex would the fix be? (trivial / moderate / significant)
4. **Suggestion**: If yes, briefly describe what change to make. If no, suggest a reply to the reviewer explaining why.

Be concise and direct. Do NOT make any code changes.`;

        let resultText = "";
        await new Promise<void>((resolve) => {
          spawnAgent(
            {
              prompt,
              agent: effectiveAgent,
              workingDirectory: workDir,
              maxTurns: 1,
              noSessionPersistence: true,
              outputFormat: "stream-json",
              appendSystemPrompt: systemPrompt || undefined,
              mcpConfig,
            },
            (event: AgentStreamEvent) => {
              switch (event.type) {
                case "started":
                  setRunning(sk, event.process_id);
                  break;
                case "stdout_line": {
                  const parsed = parseAgentStreamLine(event.line);
                  if (parsed?.text) {
                    appendOutput(sk, parsed.text);
                    resultText += parsed.text;
                  }
                  // Non-JSON lines are CLI UI noise — skip
                  break;
                }
                case "stderr_line":
                  appendOutput(sk, `[stderr] ${event.line}`);
                  break;
                case "completed":
                case "error":
                  setStopped(sk);
                  resolve();
                  break;
              }
            },
          ).catch(() => resolve());
        });

        if (mountedRef.current) {
          setConsiderations((prev) => {
            const next = new Map(prev);
            next.set(fixId, resultText.trim());
            return next;
          });
        }
      } catch (err) {
        setStopped(sk);
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        if (mountedRef.current) {
          setConsideringId(null);
        }
      }
    },
    [activeProject, task, fixes, replies, stage.task_stage_id, stage.agent_override, stage.agent, buildAgentContext, clearOutput, setRunning, setStopped, appendOutput],
  );

  const resolveComment = useCallback(
    async (fixId: string) => {
      if (!activeProject || !task?.pr_url) return;

      const fix = fixes.find((f) => f.id === fixId);
      if (!fix || fix.comment_type !== "inline") return;

      const parsed = parsePrUrl(task.pr_url);
      if (!parsed) return;

      setResolvingId(fixId);
      setError(null);

      try {
        const workDir = getTaskWorkingDir(task, activeProject.path);
        const threads = await ghFetchReviewThreads(
          workDir, parsed.owner, parsed.repo, parsed.number,
        );
        const thread = threads.find((t) =>
          t.commentDatabaseIds.includes(fix.comment_id),
        );

        if (!thread) {
          setError("Could not find review thread for this comment.");
          return;
        }

        if (!thread.isResolved) {
          await ghResolveReviewThread(workDir, thread.id);
        }

        setResolvedIds((prev) => new Set(prev).add(fixId));
        sendNotification("Thread resolved", fix.body.slice(0, 60), "success", {
          projectId: activeProject.id,
          taskId: task.id,
        });
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setResolvingId(null);
      }
    },
    [activeProject, task, fixes],
  );

  const unresolveComment = useCallback(
    async (fixId: string) => {
      if (!activeProject || !task?.pr_url) return;

      const fix = fixes.find((f) => f.id === fixId);
      if (!fix || fix.comment_type !== "inline") return;

      const parsed = parsePrUrl(task.pr_url);
      if (!parsed) return;

      setResolvingId(fixId);
      setError(null);

      try {
        const workDir = getTaskWorkingDir(task, activeProject.path);
        const threads = await ghFetchReviewThreads(
          workDir, parsed.owner, parsed.repo, parsed.number,
        );
        const thread = threads.find((t) =>
          t.commentDatabaseIds.includes(fix.comment_id),
        );

        if (!thread) {
          setError("Could not find review thread for this comment.");
          return;
        }

        if (thread.isResolved) {
          await ghUnresolveReviewThread(workDir, thread.id);
        }

        setResolvedIds((prev) => {
          const next = new Set(prev);
          next.delete(fixId);
          return next;
        });

        sendNotification("Thread unresolved", fix.body.slice(0, 60), "info", {
          projectId: activeProject.id,
          taskId: task.id,
        });
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setResolvingId(null);
      }
    },
    [activeProject, task, fixes],
  );

  const replyToComment = useCallback(
    async (commentId: number, body: string) => {
      if (!activeProject || !task?.pr_url) return;

      const parsed = parsePrUrl(task.pr_url);
      if (!parsed) return;

      setError(null);

      try {
        const reply = await ghReplyToReviewComment(
          activeProject.path,
          parsed.owner,
          parsed.repo,
          parsed.number,
          commentId,
          body,
        );

        // Optimistically add the reply to local state
        setReplies((prev) => {
          const next = new Map(prev);
          const list = [...(next.get(commentId) ?? []), reply];
          next.set(commentId, list);
          return next;
        });
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
    },
    [activeProject, task],
  );

  const pushBranch = useCallback(async () => {
    if (!activeProject || !task?.branch_name) return;
    setError(null);
    setPushing(true);

    try {
      const workDir = getTaskWorkingDir(task, activeProject.path);
      await gitPush(workDir, task.branch_name);
      sendNotification("Pushed", `Pushed to ${task.branch_name}`, "success", {
        projectId: activeProject.id,
        taskId: task.id,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setPushing(false);
    }
  }, [activeProject, task]);

  const pullBranch = useCallback(async () => {
    if (!activeProject || !task) return;
    setError(null);
    setPulling(true);

    try {
      const workDir = getTaskWorkingDir(task, activeProject.path);
      await gitPull(workDir);
      sendNotification("Pulled", "Pulled latest changes", "success", {
        projectId: activeProject.id,
        taskId: task.id,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setPulling(false);
    }
  }, [activeProject, task]);

  // Load cached fixes from DB first, then auto-fetch from network
  useEffect(() => {
    mountedRef.current = true;
    if (stage.output_format !== "pr_review" || !activeProject || !task) return;

    hasCachedFixesRef.current = false;
    let cancelled = false;
    (async () => {
      // Eagerly load cached fixes from DB (no network, fast)
      try {
        const existing = await repo.getLatestExecution(
          activeProject.id, task.id, stage.task_stage_id,
        );
        if (!cancelled && existing) {
          const cached = await repo.listPrReviewFixes(activeProject.id, existing.id);
          if (!cancelled && cached.length > 0) {
            hasCachedFixesRef.current = true;
            setFixes(cached);
            setExecutionId(existing.id);
          }
        }
      } catch {
        // Non-critical — network fetch will follow
      }

      // Then refresh from network
      if (!cancelled && task.pr_url && task.status !== "completed") {
        fetchReviewsRef.current();
      }
    })();

    return () => {
      cancelled = true;
      mountedRef.current = false;
    };
  }, [task?.id, task?.pr_url, activeProject?.id, stage.task_stage_id, stage.output_format]);

  // Polling (only for pr_review stages)
  useEffect(() => {
    if (stage.output_format !== "pr_review") return;
    if (!task?.pr_url || !activeProject || task.status === "completed") return;

    pollingRef.current = setInterval(() => {
      if (fixingId) return; // Don't poll while fixing
      fetchReviewsRef.current();
    }, PR_REVIEW_POLL_MS);

    return () => {
      if (pollingRef.current) {
        clearInterval(pollingRef.current);
        pollingRef.current = null;
      }
    };
  }, [task?.id, task?.pr_url, activeProject?.id, fixingId, task?.status]);

  return {
    fixes,
    replies,
    loading,
    fixingId,
    consideringId,
    considerations,
    resolvingId,
    resolvedIds,
    pushing,
    pulling,
    error,
    fetchReviews,
    fixComment,
    considerComment,
    commitFix,
    skipFixCommit,
    resolveComment,
    unresolveComment,
    replyToComment,
    pushBranch,
    pullBranch,
  };
}
