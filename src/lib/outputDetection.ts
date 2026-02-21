import type { OutputFormat } from "./types";

export type DetectedType =
  | "text"
  | "options"
  | "checklist"
  | "structured"
  | "research"
  | "findings"
  | "plan"
  | "pr_preparation"
  | "pr_review"
  | "merge"
  | "task_splitting"
  | "interactive_terminal";

/**
 * Detect the interaction type from output content.
 *
 * Priority order:
 * 1. Integration formats (merge, pr_review) — keep as-is when hinted
 * 2. JSON content detection based on shape
 * 3. Fallback to plain text
 */
export function detectInteractionType(
  output: string,
  formatHint?: OutputFormat,
): DetectedType {
  // Integration formats: always trust the hint
  if (formatHint === "merge") return "merge";
  if (formatHint === "pr_review") return "pr_review";
  if (formatHint === "pr_preparation") return "pr_preparation";
  if (formatHint === "interactive_terminal") return "interactive_terminal";

  // Explicit non-auto hints: trust them
  if (formatHint && formatHint !== "auto") return formatHint as DetectedType;

  // Try JSON parse for auto-detection
  try {
    const data = JSON.parse(output);
    if (typeof data !== "object" || data === null) return "text";

    // proposed_tasks array → task splitting UI
    if (Array.isArray(data.proposed_tasks)) return "task_splitting";

    // findings array → findings/checklist UI
    if (Array.isArray(data.findings)) return "findings";

    // research key → research UI
    if (typeof data.research === "string") return "research";

    // plan key → plan UI
    if (typeof data.plan === "string") return "plan";

    // options array → selection UI
    if (Array.isArray(data.options)) return "options";

    // questions array (without options) → research UI (Q&A)
    if (Array.isArray(data.questions) && data.questions.length > 0) return "research";

    // fields object → structured form UI
    if (data.fields && typeof data.fields === "object" && !Array.isArray(data.fields)) return "structured";

    // items array (checklist pattern)
    if (Array.isArray(data.items)) return "checklist";
  } catch {
    // Not JSON — fall through to text
  }

  return "text";
}

/**
 * Returns true when the given output format renders its own action button
 * inside the output component (e.g. "Approve & Continue", "Apply Selected").
 *
 * `text` format and `findings` Phase 2 (non-JSON text summary) do NOT render
 * their own button, so StageView must provide the fallback.
 *
 * This is the single source of truth — used by both StageView (to decide
 * whether to show a fallback button) and potentially by StageOutput.
 */
export function formatHasOwnActionButton(
  output: string,
  formatHint?: OutputFormat,
): boolean {
  const effectiveFormat = detectInteractionType(output, formatHint);
  if (effectiveFormat === "text") return false;
  if (effectiveFormat === "findings") {
    // Phase 2 findings (non-JSON) renders as plain text with no button
    try {
      const parsed = JSON.parse(output);
      if (parsed.findings && Array.isArray(parsed.findings)) return true;
    } catch {
      /* not JSON — Phase 2, no button */
    }
    return false;
  }
  return true;
}
