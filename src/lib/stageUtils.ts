import { detectInteractionType } from "./outputDetection";
import type { StageTemplate, StageExecution, GateRule } from "./types";

/** Try to find and validate a JSON object in a string. Searches raw stdout lines too. */
export function extractJson(text: string): string | null {
  if (!text) return null;

  // First try: parse the whole thing
  try {
    JSON.parse(text);
    return text;
  } catch {
    // continue
  }

  // Second try: find JSON in stream-json / JSONL result lines
  // Claude: look for "result" events (structured_output or result field)
  // Codex:  look for the last "item.completed" with type "agent_message"
  let lastCodexMessage: string | null = null;
  for (const line of text.split("\n")) {
    try {
      const event = JSON.parse(line);
      if (event.type === "result") {
        const output = event.structured_output ?? event.result;
        if (output != null && output !== "") {
          const str =
            typeof output === "string" ? output : JSON.stringify(output);
          const parsed = JSON.parse(str);
          if (typeof parsed === "object" && parsed !== null) {
            return str;
          }
        }
      }
      // Codex: agent_message items contain the structured output
      if (event.type === "item.completed" && event.item?.type === "agent_message" && event.item?.text) {
        lastCodexMessage = event.item.text;
      }
    } catch {
      // continue
    }
  }
  // Return the last Codex agent_message if found (the final one is the structured response)
  if (lastCodexMessage) {
    try {
      const parsed = JSON.parse(lastCodexMessage);
      if (typeof parsed === "object" && parsed !== null) {
        return lastCodexMessage;
      }
    } catch {
      // Not valid JSON — still return it as-is
      return lastCodexMessage;
    }
  }

  // Third try: find a JSON object in the text
  // Use greedy match first (handles nested objects), fall back to lazy (handles multiple separate objects)
  const greedyMatch = text.match(/\{[\s\S]*\}/);
  if (greedyMatch) {
    try {
      JSON.parse(greedyMatch[0]);
      return greedyMatch[0];
    } catch {
      // Greedy match failed (likely grabbed across multiple separate JSON objects) — try lazy
      const lazyMatch = text.match(/\{[\s\S]*?\}/);
      if (lazyMatch) {
        try {
          JSON.parse(lazyMatch[0]);
          return lazyMatch[0];
        } catch {
          // continue
        }
      }
    }
  }

  return null;
}

/** Extract a clean, human-readable output from a stage for its stage_result. */
export function extractStageOutput(
  stage: StageTemplate,
  execution: StageExecution,
  decision?: string,
): string {
  const raw = execution.parsed_output ?? execution.raw_output ?? "";

  // Resolve effective format for "auto" stages
  const format = stage.output_format === "auto"
    ? detectInteractionType(raw, "auto")
    : stage.output_format;

  switch (format) {
    case "research": {
      // Extract the markdown research text from the JSON envelope
      try {
        const data = JSON.parse(raw);
        if (data.research) return data.research;
      } catch {
        // fall through
      }
      return raw;
    }
    case "plan": {
      // Extract the plan text from the JSON envelope
      try {
        const data = JSON.parse(raw);
        if (data.plan) return data.plan;
      } catch {
        // fall through
      }
      return raw;
    }
    case "options": {
      // The stage's value is the user's selection, not the full options list
      if (decision) return formatSelectedApproach(decision);
      return raw;
    }
    case "findings": {
      // Phase 1 (skip all): extract summary from JSON
      // Phase 2 (applied fixes): raw text output
      try {
        const data = JSON.parse(raw);
        if (data.summary) return data.summary;
      } catch {
        // Parse failed — this is phase 2 text output
      }
      return raw;
    }
    case "task_splitting": {
      try {
        const data = JSON.parse(raw);
        if (data.reasoning) return data.reasoning;
      } catch { /* fall through */ }
      return raw;
    }
    case "pr_review":
      return raw || "PR Review completed";
    case "merge":
      return raw || "Branch merged successfully";
    case "interactive_terminal":
      return raw || "Interactive session completed";
    default:
      return raw;
  }
}

export function formatSelectedApproach(decision: string): string {
  try {
    const selected = JSON.parse(decision);
    if (!Array.isArray(selected) || selected.length === 0) return decision;
    const approach = selected[0];
    let text = `## Selected Approach: ${approach.title}\n\n${approach.description}`;
    if (approach.pros?.length) {
      text += `\n\n**Pros:**\n${approach.pros.map((p: string) => `- ${p}`).join("\n")}`;
    }
    if (approach.cons?.length) {
      text += `\n\n**Cons:**\n${approach.cons.map((c: string) => `- ${c}`).join("\n")}`;
    }
    return text;
  } catch {
    return decision;
  }
}

/** Extract a concise summary from a stage's output for use in PR preparation. */
export function extractStageSummary(
  stage: StageTemplate,
  execution: StageExecution,
  decision?: string,
): string | null {
  const raw = execution.parsed_output ?? execution.raw_output ?? "";
  if (!raw.trim()) return null;

  // Resolve effective format for "auto" stages
  const format = stage.output_format === "auto"
    ? detectInteractionType(raw, "auto")
    : stage.output_format;

  switch (format) {
    case "research": {
      try {
        const data = JSON.parse(raw);
        if (data.research) return truncateToSentences(data.research, 3);
      } catch { /* fall through */ }
      return truncateToSentences(raw, 3);
    }
    case "plan": {
      try {
        const data = JSON.parse(raw);
        if (data.plan) return truncateToSentences(data.plan, 3);
      } catch { /* fall through */ }
      return truncateToSentences(raw, 3);
    }
    case "options": {
      if (decision) {
        try {
          const selected = JSON.parse(decision);
          if (Array.isArray(selected) && selected.length > 0) {
            const approach = selected[0];
            return `Selected: ${approach.title} — ${truncateToSentences(approach.description, 2)}`;
          }
        } catch { /* fall through */ }
      }
      return truncateToSentences(raw, 3);
    }
    case "findings": {
      try {
        const data = JSON.parse(raw);
        if (data.summary) return data.summary;
      } catch {
        // Phase 2 text output — summarize
      }
      return truncateToSentences(raw, 3);
    }
    case "task_splitting": {
      try {
        const data = JSON.parse(raw);
        const count = data.proposed_tasks?.length ?? 0;
        const summary = `Task split into ${count} subtask${count !== 1 ? "s" : ""}.`;
        return data.reasoning ? `${summary} ${truncateToSentences(data.reasoning, 2)}` : summary;
      } catch { /* fall through */ }
      return truncateToSentences(raw, 3);
    }
    case "pr_review":
      return raw ? truncateToSentences(raw, 3) : null;
    case "merge":
      return raw ? truncateToSentences(raw, 3) : null;
    case "interactive_terminal":
      return raw ? truncateToSentences(raw, 3) : "Interactive session completed";
    case "text": {
      return extractImplementationSummary(raw);
    }
    default:
      return truncateToSentences(raw, 3);
  }
}

/** Extract first N sentences from text. */
export function truncateToSentences(text: string, n: number): string {
  // Strip markdown headers for cleaner extraction
  const cleaned = text.replace(/^#+\s+.*$/gm, "").trim();
  // Match sentences ending with . ! or ?
  const sentences = cleaned.match(/[^.!?]*[.!?]+/g);
  if (!sentences || sentences.length === 0) {
    // No clear sentences — take first ~300 chars
    return cleaned.slice(0, 300).trim();
  }
  return sentences.slice(0, n).join("").trim();
}

/** Extract summary from implementation (text format) output. */
export function extractImplementationSummary(raw: string): string | null {
  if (!raw.trim()) return null;

  // Look for explicit summary sections near end of output
  const summaryMatch = raw.match(
    /(?:^|\n)#+\s*(?:Summary|Changes Made|What (?:was|I) (?:changed|did))[^\n]*\n([\s\S]{10,500}?)(?:\n#|\n---|\n\*\*|$)/i,
  );
  if (summaryMatch) {
    return truncateToSentences(summaryMatch[1].trim(), 3);
  }

  // Fall back to last paragraph (implementation output often ends with a summary)
  const paragraphs = raw.split(/\n\n+/).filter((p) => p.trim().length > 20);
  if (paragraphs.length > 0) {
    const last = paragraphs[paragraphs.length - 1].trim();
    return truncateToSentences(last, 3);
  }

  return truncateToSentences(raw, 3);
}

export function validateGate(
  rule: GateRule,
  decision: string | undefined,
  _execution: StageExecution,
): boolean {
  switch (rule.type) {
    case "require_approval":
      return true;
    case "require_selection": {
      if (!decision) return false;
      try {
        const selected = JSON.parse(decision);
        if (!Array.isArray(selected)) return false;
        return (
          selected.length >= rule.min && selected.length <= rule.max
        );
      } catch {
        return true; // Treat non-array as single selection
      }
    }
    case "require_all_checked": {
      if (!decision) return false;
      try {
        const items = JSON.parse(decision);
        return (
          Array.isArray(items) && items.every((item: { checked: boolean }) => item.checked)
        );
      } catch {
        return false;
      }
    }
    case "require_fields": {
      if (!decision) return false;
      try {
        const fields = JSON.parse(decision);
        return rule.fields.every(
          (f) => fields[f] && String(fields[f]).trim().length > 0,
        );
      } catch {
        return false;
      }
    }
    default:
      return true;
  }
}

/** Determine whether a stage should be auto-started after the previous stage completes. */
export function shouldAutoStartStage(stage: StageTemplate): boolean {
  if (stage.output_format === "merge") return false;
  if (stage.output_format === "interactive_terminal") return false;
  return !stage.requires_user_input;
}
