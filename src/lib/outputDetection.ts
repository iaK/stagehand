import type { OutputFormat } from "./types";

export type DetectedType =
  | "text"
  | "options"
  | "checklist"
  | "structured"
  | "research"
  | "findings"
  | "plan"
  | "pr_review"
  | "merge";

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

  // Explicit non-auto hints: trust them
  if (formatHint && formatHint !== "auto") return formatHint as DetectedType;

  // Try JSON parse for auto-detection
  try {
    const data = JSON.parse(output);
    if (typeof data !== "object" || data === null) return "text";

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
