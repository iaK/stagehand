import {
  extractJson,
  extractStageOutput,
  extractStageSummary,
  truncateToSentences,
  validateGate,
  formatSelectedApproach,
  extractImplementationSummary,
} from "../useStageExecution";
import { makeStageTemplate, makeStageExecution } from "../../test/fixtures";
import type { GateRule } from "../../lib/types";

// ─── extractJson ────────────────────────────────────────────────────────────

describe("extractJson", () => {
  it("returns valid JSON string as-is", () => {
    const json = '{"key": "value"}';
    expect(extractJson(json)).toBe(json);
  });

  it("extracts from stream-json result line with structured_output", () => {
    // In practice, result lines are mixed with other stream events
    const text = [
      JSON.stringify({ type: "assistant", message: { content: [{ type: "text", text: "..." }] } }),
      JSON.stringify({ type: "result", structured_output: { research: "findings" } }),
    ].join("\n");
    expect(extractJson(text)).toBe(JSON.stringify({ research: "findings" }));
  });

  it("extracts from stream-json result line with result field", () => {
    const text = [
      "some non-json output",
      JSON.stringify({ type: "result", result: '{"plan": "do things"}' }),
    ].join("\n");
    expect(extractJson(text)).toBe('{"plan": "do things"}');
  });

  it("extracts embedded JSON object from text via regex", () => {
    const text = 'Some prefix text {"found": true} some suffix';
    expect(extractJson(text)).toBe('{"found": true}');
  });

  it("returns null when no JSON found", () => {
    expect(extractJson("just plain text")).toBeNull();
  });

  it("returns null for empty/null input", () => {
    expect(extractJson("")).toBeNull();
    expect(extractJson(null as unknown as string)).toBeNull();
  });

  it("handles nested JSON objects", () => {
    const json = '{"outer": {"inner": "value"}}';
    expect(extractJson(json)).toBe(json);
  });

  it("handles result line with object (not string) structured_output", () => {
    const text = [
      "non-json prefix",
      JSON.stringify({ type: "result", structured_output: { data: [1, 2, 3] } }),
    ].join("\n");
    const result = extractJson(text);
    expect(result).toBe(JSON.stringify({ data: [1, 2, 3] }));
  });

  it("handles multiline stream-json with non-result lines followed by result", () => {
    const text = [
      JSON.stringify({ type: "assistant", message: { content: [{ type: "text", text: "thinking..." }] } }),
      JSON.stringify({ type: "result", structured_output: { answer: "42" } }),
    ].join("\n");
    expect(extractJson(text)).toBe(JSON.stringify({ answer: "42" }));
  });

  it("extracts first valid JSON when multiple separate objects exist in text", () => {
    const text = 'prefix {"a":1} some text {"b":2} suffix';
    const result = extractJson(text);
    expect(result).toBe('{"a":1}');
  });
});

// ─── validateGate ───────────────────────────────────────────────────────────

describe("validateGate", () => {
  const execution = makeStageExecution();

  it("require_approval always returns true", () => {
    const rule: GateRule = { type: "require_approval" };
    expect(validateGate(rule, undefined, execution)).toBe(true);
  });

  it("require_selection with valid count returns true", () => {
    const rule: GateRule = { type: "require_selection", min: 1, max: 2 };
    const decision = JSON.stringify([{ id: "a" }]);
    expect(validateGate(rule, decision, execution)).toBe(true);
  });

  it("require_selection with too few selections returns false", () => {
    const rule: GateRule = { type: "require_selection", min: 2, max: 3 };
    const decision = JSON.stringify([{ id: "a" }]);
    expect(validateGate(rule, decision, execution)).toBe(false);
  });

  it("require_selection with too many selections returns false", () => {
    const rule: GateRule = { type: "require_selection", min: 1, max: 1 };
    const decision = JSON.stringify([{ id: "a" }, { id: "b" }]);
    expect(validateGate(rule, decision, execution)).toBe(false);
  });

  it("require_selection with no decision returns false", () => {
    const rule: GateRule = { type: "require_selection", min: 1, max: 1 };
    expect(validateGate(rule, undefined, execution)).toBe(false);
  });

  it("require_selection with non-JSON decision returns true (treated as single selection)", () => {
    const rule: GateRule = { type: "require_selection", min: 1, max: 1 };
    expect(validateGate(rule, "not json", execution)).toBe(true);
  });

  it("require_all_checked with all checked returns true", () => {
    const rule: GateRule = { type: "require_all_checked" };
    const decision = JSON.stringify([
      { checked: true },
      { checked: true },
    ]);
    expect(validateGate(rule, decision, execution)).toBe(true);
  });

  it("require_all_checked with some unchecked returns false", () => {
    const rule: GateRule = { type: "require_all_checked" };
    const decision = JSON.stringify([
      { checked: true },
      { checked: false },
    ]);
    expect(validateGate(rule, decision, execution)).toBe(false);
  });

  it("require_all_checked with no decision returns false", () => {
    const rule: GateRule = { type: "require_all_checked" };
    expect(validateGate(rule, undefined, execution)).toBe(false);
  });

  it("require_fields with all fields present returns true", () => {
    const rule: GateRule = { type: "require_fields", fields: ["title", "description"] };
    const decision = JSON.stringify({ title: "PR Title", description: "Details" });
    expect(validateGate(rule, decision, execution)).toBe(true);
  });

  it("require_fields with missing field returns false", () => {
    const rule: GateRule = { type: "require_fields", fields: ["title", "description"] };
    const decision = JSON.stringify({ title: "PR Title" });
    expect(validateGate(rule, decision, execution)).toBe(false);
  });

  it("require_fields with empty field returns false", () => {
    const rule: GateRule = { type: "require_fields", fields: ["title"] };
    const decision = JSON.stringify({ title: "  " });
    expect(validateGate(rule, decision, execution)).toBe(false);
  });

  it("require_fields with no decision returns false", () => {
    const rule: GateRule = { type: "require_fields", fields: ["title"] };
    expect(validateGate(rule, undefined, execution)).toBe(false);
  });

  it("require_selection with non-array JSON returns false", () => {
    const rule: GateRule = { type: "require_selection", min: 1, max: 1 };
    const decision = JSON.stringify({ id: "a" });
    expect(validateGate(rule, decision, execution)).toBe(false);
  });
});

// ─── truncateToSentences ────────────────────────────────────────────────────

describe("truncateToSentences", () => {
  it("returns first N sentences", () => {
    const text = "First sentence. Second sentence. Third sentence. Fourth.";
    expect(truncateToSentences(text, 2)).toBe("First sentence. Second sentence.");
  });

  it("returns first 300 chars when no sentence endings", () => {
    const text = "A".repeat(400);
    const result = truncateToSentences(text, 3);
    expect(result).toHaveLength(300);
  });

  it("strips markdown headers before extraction", () => {
    const text = "# Header\nThis is the first sentence. And the second.";
    const result = truncateToSentences(text, 1);
    expect(result).toBe("This is the first sentence.");
    expect(result).not.toContain("#");
  });

  it("handles empty text", () => {
    expect(truncateToSentences("", 3)).toBe("");
  });

  it("handles text with exclamation and question marks", () => {
    const text = "Wow! Is this working? Yes it is.";
    expect(truncateToSentences(text, 2)).toBe("Wow! Is this working?");
  });
});

// ─── extractStageOutput ─────────────────────────────────────────────────────

describe("extractStageOutput", () => {
  it("research format extracts research field from JSON", () => {
    const stage = makeStageTemplate({ output_format: "research" });
    const exec = makeStageExecution({
      parsed_output: JSON.stringify({ research: "Found the bug in auth." }),
    });
    expect(extractStageOutput(stage, exec)).toBe("Found the bug in auth.");
  });

  it("plan format extracts plan field from JSON", () => {
    const stage = makeStageTemplate({ output_format: "plan" });
    const exec = makeStageExecution({
      parsed_output: JSON.stringify({ plan: "Step 1: Fix it." }),
    });
    expect(extractStageOutput(stage, exec)).toBe("Step 1: Fix it.");
  });

  it("options format with decision formats selected approach", () => {
    const stage = makeStageTemplate({ output_format: "options" });
    const exec = makeStageExecution({ parsed_output: "raw options" });
    const decision = JSON.stringify([
      {
        title: "Approach A",
        description: "Do it this way",
        pros: ["Fast"],
        cons: ["Complex"],
      },
    ]);
    const result = extractStageOutput(stage, exec, decision);
    expect(result).toContain("Approach A");
    expect(result).toContain("Do it this way");
    expect(result).toContain("Fast");
    expect(result).toContain("Complex");
  });

  it("options format without decision returns raw", () => {
    const stage = makeStageTemplate({ output_format: "options" });
    const exec = makeStageExecution({ parsed_output: "raw options data" });
    expect(extractStageOutput(stage, exec)).toBe("raw options data");
  });

  it("findings format with summary extracts summary", () => {
    const stage = makeStageTemplate({ output_format: "findings" });
    const exec = makeStageExecution({
      parsed_output: JSON.stringify({ summary: "All good", findings: [] }),
    });
    expect(extractStageOutput(stage, exec)).toBe("All good");
  });

  it("pr_review format returns raw or default", () => {
    const stage = makeStageTemplate({ output_format: "pr_review" });
    const exec = makeStageExecution({ parsed_output: "" });
    expect(extractStageOutput(stage, exec)).toBe("PR Review completed");

    const exec2 = makeStageExecution({ parsed_output: "Review content" });
    expect(extractStageOutput(stage, exec2)).toBe("Review content");
  });

  it("text format returns raw output", () => {
    const stage = makeStageTemplate({ output_format: "text" });
    const exec = makeStageExecution({ parsed_output: "implementation output" });
    expect(extractStageOutput(stage, exec)).toBe("implementation output");
  });
});

// ─── extractStageSummary ────────────────────────────────────────────────────

describe("extractStageSummary", () => {
  it("research format produces summary from research field", () => {
    const stage = makeStageTemplate({ output_format: "research" });
    const exec = makeStageExecution({
      parsed_output: JSON.stringify({
        research: "The bug is in auth. It affects login. Users cannot sign in.",
      }),
    });
    const summary = extractStageSummary(stage, exec);
    expect(summary).toContain("The bug is in auth.");
  });

  it("options format with decision produces summary", () => {
    const stage = makeStageTemplate({ output_format: "options" });
    const exec = makeStageExecution({ parsed_output: "raw" });
    const decision = JSON.stringify([
      { title: "Approach A", description: "The fast approach. It works well." },
    ]);
    const summary = extractStageSummary(stage, exec, decision);
    expect(summary).toContain("Approach A");
  });

  it("returns null for empty output", () => {
    const stage = makeStageTemplate({ output_format: "text" });
    const exec = makeStageExecution({ parsed_output: "", raw_output: "" });
    expect(extractStageSummary(stage, exec)).toBeNull();
  });

  it("text format extracts implementation summary", () => {
    const stage = makeStageTemplate({ output_format: "text" });
    const exec = makeStageExecution({
      parsed_output: "Did some work.\n\n## Summary\nFixed the login bug by updating the auth middleware.",
    });
    const summary = extractStageSummary(stage, exec);
    expect(summary).toContain("Fixed the login bug");
  });
});

// ─── formatSelectedApproach ─────────────────────────────────────────────────

describe("formatSelectedApproach", () => {
  it("formats valid JSON decision with all fields", () => {
    const decision = JSON.stringify([
      {
        title: "My Approach",
        description: "The best way",
        pros: ["Fast", "Simple"],
        cons: ["Limited"],
      },
    ]);
    const result = formatSelectedApproach(decision);
    expect(result).toContain("## Selected Approach: My Approach");
    expect(result).toContain("The best way");
    expect(result).toContain("**Pros:**");
    expect(result).toContain("- Fast");
    expect(result).toContain("- Simple");
    expect(result).toContain("**Cons:**");
    expect(result).toContain("- Limited");
  });

  it("returns original string for invalid JSON", () => {
    expect(formatSelectedApproach("not json")).toBe("not json");
  });

  it("returns original string for empty array", () => {
    expect(formatSelectedApproach("[]")).toBe("[]");
  });

  it("handles approach without pros/cons", () => {
    const decision = JSON.stringify([
      { title: "Simple", description: "Just do it" },
    ]);
    const result = formatSelectedApproach(decision);
    expect(result).toContain("## Selected Approach: Simple");
    expect(result).toContain("Just do it");
    expect(result).not.toContain("**Pros:**");
    expect(result).not.toContain("**Cons:**");
  });
});

// ─── extractImplementationSummary ───────────────────────────────────────────

describe("extractImplementationSummary", () => {
  it("extracts text following a Summary header", () => {
    const raw = `Did lots of work here.

## Summary
Fixed the authentication middleware to handle expired tokens gracefully.`;
    const result = extractImplementationSummary(raw);
    expect(result).toContain("Fixed the authentication middleware");
  });

  it("falls back to last paragraph when no summary header", () => {
    const raw = `First paragraph with some content here.

Second paragraph that is also long enough to pass the filter.

This is the final paragraph which should be the fallback summary content for the implementation.`;
    const result = extractImplementationSummary(raw);
    expect(result).toContain("final paragraph");
  });

  it("returns null for empty text", () => {
    expect(extractImplementationSummary("")).toBeNull();
    expect(extractImplementationSummary("   ")).toBeNull();
  });

  it("handles 'Changes Made' header variant", () => {
    const raw = `Working on things.

## Changes Made
Updated the login form validation. Added error messages. Improved UX.`;
    const result = extractImplementationSummary(raw);
    expect(result).toContain("Updated the login form validation.");
  });
});
