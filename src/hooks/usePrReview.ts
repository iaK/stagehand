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

export interface Consideration {
  verdict: "fix" | "dismiss" | "discuss";
  reasoning: string;
  suggested_reply: string | null;
}

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
  const [considerations, setConsiderations] = useState<Map<string, Consideration>>(new Map());
  const [pushing, setPushing] = useState(false);
  const [pulling, setPulling] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [executionId, setExecutionId] = useState<string | null>(null);
  const [summary, setSummary] = useState<string | null>(null);
  const [summaryLoading, setSummaryLoading] = useState(false);
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const mountedRef = useRef(true);
  const isFetchingRef = useRef(false);
  const fetchReviewsRef = useRef<() => Promise<void>>(() => Promise.resolve());
  const preFixFilesRef = useRef<Set<string>>(new Set());
  const hasLoadedOnceRef = useRef(false);
  const summaryHashRef = useRef<string | null>(null);
  const isGeneratingSummaryRef = useRef(false);

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

  /** Compute a simple hash from review data to detect changes. */
  function computeReviewHash(
    fixList: PrReviewFix[],
    replyMap: Map<number, GhReviewComment[]>,
    resolved: Set<string>,
  ): string {
    const parts: string[] = [];
    for (const f of fixList) {
      parts.push(`${f.comment_id}:${f.body.length}:${f.state}`);
      const r = replyMap.get(f.comment_id);
      if (r) parts.push(`r${r.length}`);
      if (resolved.has(f.id)) parts.push("R");
    }
    // Simple djb2 hash
    const str = parts.join("|");
    let hash = 5381;
    for (let i = 0; i < str.length; i++) {
      hash = ((hash << 5) + hash + str.charCodeAt(i)) | 0;
    }
    return (hash >>> 0).toString(36);
  }

  /** Generate an AI summary of the review state. */
  const generateSummary = useCallback(
    async (
      fixList: PrReviewFix[],
      replyMap: Map<number, GhReviewComment[]>,
      resolved: Set<string>,
    ) => {
      if (!activeProject || !task || isGeneratingSummaryRef.current) return;
      isGeneratingSummaryRef.current = true;
      setSummaryLoading(true);

      const workDir = getTaskWorkingDir(task, activeProject.path);
      const effectiveAgent = await repo.getEffectiveAgent(activeProject.id, stage.agent_override, stage.agent);
      const effectiveModel = await repo.getEffectiveModel(activeProject.id, stage.model_override, stage.persona_model);

      // Build a text representation of the review state
      const lines: string[] = [`Task: ${task.title}`, ""];

      for (const fix of fixList) {
        const isResolved = fix.state === "APPROVED" || fix.state === "DISMISSED" || resolved.has(fix.id);
        const status = isResolved ? "[RESOLVED]" : "[OPEN]";
        const location = fix.file_path ? `${fix.file_path}${fix.line ? `:${fix.line}` : ""}` : "(general)";
        lines.push(`${status} ${fix.author} (${fix.comment_type}) at ${location}:`);
        lines.push(fix.body.slice(0, 500));

        const commentReplies = replyMap.get(fix.comment_id);
        if (commentReplies && commentReplies.length > 0) {
          for (const r of commentReplies) {
            lines.push(`  Reply by ${r.user.login}: ${r.body.slice(0, 300)}`);
          }
        }
        lines.push("");
      }

      const prompt = `You are summarizing a GitHub PR code review for the developer who needs to act on it.

Here are all the review comments and their status:

${lines.join("\n")}

Write a brief, natural summary that helps the developer quickly decide where to focus.

Start with one sentence on overall status. Then, only if relevant, mention what needs action — unanswered questions, unresolved feedback, or active discussions. Skip anything that's already resolved or has nothing to report. If everything is done, just say so.

Formatting rules:
- Write naturally — like a knowledgeable colleague giving a quick verbal update.
- 2-4 short sentences max. Be concise. Every word should earn its place.
- Use **bold** sparingly to highlight the most important action items or file names.
- Do NOT use section labels like "Status:", "Questions:", etc.
- Do NOT use markdown headers (#), bullet points, or numbered lists.
- Do NOT repeat yourself.`;

      try {
        let resultText = "";
        let gotResult = false;
        await new Promise<void>((resolve) => {
          spawnAgent(
            {
              prompt,
              agent: effectiveAgent,
              personaModel: effectiveModel,
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
                  if (!parsed) break;
                  // Prefer the final "result" text (deduplicated).
                  // Fall back to streaming "text" chunks if no result arrives.
                  if (parsed.type === "result" && parsed.text) {
                    resultText = parsed.text;
                    gotResult = true;
                  } else if (parsed.type === "text" && !gotResult) {
                    resultText += parsed.text;
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

        const text = resultText.trim();
        if (text && mountedRef.current) {
          setSummary(text);
          // Persist summary + hash
          const hash = computeReviewHash(fixList, replyMap, resolved);
          summaryHashRef.current = hash;
          if (activeProject && task) {
            const key = `pr_summary:${task.id}`;
            await repo.setProjectSetting(activeProject.id, key, text);
            await repo.setProjectSetting(activeProject.id, `${key}:hash`, hash);
          }
        }
      } catch {
        // Non-critical
      } finally {
        isGeneratingSummaryRef.current = false;
        if (mountedRef.current) setSummaryLoading(false);
      }
    },
    [activeProject, task, stage.agent_override, stage.agent],
  );

  /** Check if review data changed and regenerate summary if needed. */
  const maybeRegenerateSummary = useCallback(
    async (
      fixList: PrReviewFix[],
      replyMap: Map<number, GhReviewComment[]>,
      resolved: Set<string>,
    ) => {
      if (!activeProject || !task || fixList.length === 0) return;
      const hash = computeReviewHash(fixList, replyMap, resolved);
      if (hash === summaryHashRef.current) return;

      // Hash changed — regenerate
      await generateSummary(fixList, replyMap, resolved);
    },
    [activeProject, task, generateSummary],
  );

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
    setLoading(true);
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

      const previousCount = fixes.length;

      // Build fixes from GitHub API data (no local DB storage)
      const newFixes: PrReviewFix[] = [];

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

      // Review-level comments (APPROVED, CHANGES_REQUESTED, etc.)
      for (const review of reviews) {
        if (review.body?.trim()) {
          newFixes.push({
            id: `review-${review.id}`,
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
            submitted_at: review.submitted_at,
          });
        } else {
          // Placeholder for reviews without body that have inline comments
          const hasInlineComments = rootComments.some(
            (c) => c.pull_request_review_id === review.id,
          );
          if (hasInlineComments) {
            newFixes.push({
              id: `review-${review.id}`,
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
              submitted_at: review.submitted_at,
            });
          }
        }
      }

      // Root inline review comments
      for (const comment of rootComments) {
        newFixes.push({
          id: `inline-${comment.id}`,
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
          submitted_at: comment.created_at,
        });
      }

      // General PR conversation comments
      for (const comment of issueComments) {
        if (comment.user.login.endsWith("[bot]")) continue;
        newFixes.push({
          id: `conversation-${comment.id}`,
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
          submitted_at: comment.created_at,
        });
      }

      // Fetch resolved thread status from GitHub
      let newResolvedIds = new Set<string>();
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
        for (const fix of newFixes) {
          if (fix.comment_type === "inline" && resolvedCommentIds.has(fix.comment_id)) {
            newResolvedIds.add(fix.id);
          }
        }
      } catch {
        // Non-critical
      }

      const newCount = newFixes.length - previousCount;
      if (newCount > 0 && hasLoadedOnceRef.current) {
        sendNotification("PR Review", `${newCount} new review comment${newCount === 1 ? "" : "s"}`, "info", { projectId: activeProject.id, taskId: task.id });
      }
      if (mountedRef.current) {
        hasLoadedOnceRef.current = true;
        setFixes(newFixes);
        setReplies(replyMap);
        setResolvedIds(newResolvedIds);
      }

      // Check if summary needs regeneration (runs in background, non-blocking)
      maybeRegenerateSummary(newFixes, replyMap, newResolvedIds).catch(() => {});
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
  }, [activeProject, task, fixes.length, ensureExecution, maybeRegenerateSummary]);

  // Keep ref in sync so effects always call the latest version
  fetchReviewsRef.current = fetchReviews;

  const fixComment = useCallback(
    async (fixId: string, userContext?: string) => {
      if (!activeProject || !task) return;

      const fix = fixes.find((f) => f.id === fixId);
      if (!fix) return;

      setFixingId(fixId);
      setError(null);

      const sk = stageKey(task.id, stage.task_stage_id);
      clearOutput(sk);
      setRunning(sk, "fixing");

      const workDir = getTaskWorkingDir(task, activeProject.path);

      // Resolve effective agent + model
      const effectiveAgent = await repo.getEffectiveAgent(activeProject.id, stage.agent_override, stage.agent);
      const effectiveModel = await repo.getEffectiveModel(activeProject.id, stage.model_override, stage.persona_model);

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
        const consideration = considerations.get(fixId);
        if (consideration) {
          prompt += `\n\nAI evaluation of this comment:\n${consideration.reasoning}`;
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
              personaModel: effectiveModel,
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
          ).catch((err) => {
            setStopped(sk);
            if (mountedRef.current) {
              setError(err instanceof Error ? err.message : String(err));
            }
            resolve();
          });
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
                  personaModel: effectiveModel,
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
        }

        setFixingId(null);
      } catch (err) {
        setStopped(sk);
        setFixingId(null);
        setError(err instanceof Error ? err.message : String(err));
      }
    },
    [activeProject, task, fixes, replies, considerations, stage.task_stage_id, stage.name, stage.agent_override, stage.agent, buildAgentContext, clearOutput, setRunning, setStopped, appendOutput],
  );

  const commitFix = useCallback(
    async (_fixId: string, commitMessage: string) => {
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

        useProcessStore.getState().clearPendingCommit();
        sendNotification("Fix committed", shortHash, "success", { projectId: activeProject.id, taskId: task.id });
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
    },
    [activeProject, task],
  );

  const skipFixCommit = useCallback(
    async () => {
      useProcessStore.getState().clearPendingCommit();
    },
    [],
  );

  const considerComment = useCallback(
    async (fixId: string) => {
      if (!activeProject || !task) return;

      const fix = fixes.find((f) => f.id === fixId);
      if (!fix) return;

      setConsideringId(fixId);
      setError(null);

      const workDir = getTaskWorkingDir(task, activeProject.path);
      const effectiveAgent = await repo.getEffectiveAgent(activeProject.id, stage.agent_override, stage.agent);
      const effectiveModel = await repo.getEffectiveModel(activeProject.id, stage.model_override, stage.persona_model);

      try {
        let prompt = `Evaluate the following PR review comment and decide the best action.

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

Based on the diff context and comment above, decide what to do:

- "fix" — the reviewer is right and the code should be changed
- "dismiss" — the comment can be safely dismissed (explain why in suggested_reply)
- "discuss" — you need more context from the reviewer, OR the reviewer asked a question you can answer

For "dismiss" and "discuss", write a suggested_reply that can be posted as a GitHub comment. For "fix", set suggested_reply to null.

Keep reasoning to 1-2 sentences. Be direct.

Respond with ONLY a JSON object, no markdown fences:
{"verdict": "fix"|"dismiss"|"discuss", "reasoning": "...", "suggested_reply": "..." or null}`;

        let resultText = "";
        let gotResult = false;
        await new Promise<void>((resolve) => {
          spawnAgent(
            {
              prompt,
              agent: effectiveAgent,
              personaModel: effectiveModel,
              workingDirectory: workDir,
              maxTurns: 1,
              allowedTools: [],
              noSessionPersistence: true,
              outputFormat: "stream-json",
            },
            (event: AgentStreamEvent) => {
              switch (event.type) {
                case "stdout_line": {
                  const parsed = parseAgentStreamLine(event.line);
                  if (!parsed) break;
                  if (parsed.type === "result" && parsed.text) {
                    resultText = parsed.text;
                    gotResult = true;
                  } else if (parsed.type === "text" && !gotResult) {
                    resultText += parsed.text;
                  }
                  break;
                }
                case "completed":
                case "error":
                  resolve();
                  break;
              }
            },
          ).catch((err) => {
            if (mountedRef.current) {
              setError(err instanceof Error ? err.message : String(err));
            }
            resolve();
          });
        });

        if (mountedRef.current) {
          const text = resultText.trim();
          if (text) {
            let consideration: Consideration | null = null;
            // Strip markdown fences if present
            const jsonStr = text.replace(/^```(?:json)?\s*\n?/i, "").replace(/\n?```\s*$/, "");
            try {
              const parsed = JSON.parse(jsonStr);
              if (parsed.verdict && parsed.reasoning) {
                consideration = {
                  verdict: parsed.verdict,
                  reasoning: parsed.reasoning,
                  suggested_reply: parsed.suggested_reply ?? null,
                };
              }
            } catch {
              // Fallback: treat raw text as a "discuss" consideration
              consideration = { verdict: "discuss", reasoning: text, suggested_reply: null };
            }
            if (consideration) {
              setConsiderations((prev) => {
                const next = new Map(prev);
                next.set(fixId, consideration);
                return next;
              });
            }
          }
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        if (mountedRef.current) {
          setConsideringId(null);
        }
      }
    },
    [activeProject, task, fixes, replies, stage.task_stage_id, stage.agent_override, stage.agent],
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

  // Fetch from GitHub on mount + load cached summary
  useEffect(() => {
    mountedRef.current = true;
    if (stage.output_format !== "pr_review" || !activeProject || !task) return;

    hasLoadedOnceRef.current = false;

    // Load cached summary from DB
    (async () => {
      try {
        const key = `pr_summary:${task.id}`;
        const [cached, hash] = await Promise.all([
          repo.getProjectSetting(activeProject.id, key),
          repo.getProjectSetting(activeProject.id, `${key}:hash`),
        ]);
        if (cached && mountedRef.current) {
          setSummary(cached);
          summaryHashRef.current = hash;
        }
      } catch {
        // Non-critical
      }
    })();

    if (task.pr_url && task.status !== "completed") {
      fetchReviewsRef.current();
    }

    return () => {
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
    summary,
    summaryLoading,
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
