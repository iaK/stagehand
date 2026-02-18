import { detectInteractionType } from "../outputDetection";

describe("detectInteractionType", () => {
  // Integration formats always trust the hint
  it("returns merge when hinted", () => {
    expect(detectInteractionType("anything", "merge")).toBe("merge");
  });

  it("returns pr_review when hinted", () => {
    expect(detectInteractionType("anything", "pr_review")).toBe("pr_review");
  });

  // Explicit non-auto hints are trusted
  it("returns explicit hint for non-auto formats", () => {
    expect(detectInteractionType("anything", "text")).toBe("text");
    expect(detectInteractionType("anything", "findings")).toBe("findings");
    expect(detectInteractionType("anything", "research")).toBe("research");
    expect(detectInteractionType("anything", "plan")).toBe("plan");
    expect(detectInteractionType("anything", "options")).toBe("options");
  });

  // Auto-detection from JSON content
  it("detects findings from JSON with findings array", () => {
    const output = JSON.stringify({ summary: "ok", findings: [{ id: "f1" }] });
    expect(detectInteractionType(output, "auto")).toBe("findings");
  });

  it("detects research from JSON with research key", () => {
    const output = JSON.stringify({ research: "Found the bug.", questions: [] });
    expect(detectInteractionType(output, "auto")).toBe("research");
  });

  it("detects plan from JSON with plan key", () => {
    const output = JSON.stringify({ plan: "Step 1: Do it.", questions: [] });
    expect(detectInteractionType(output, "auto")).toBe("plan");
  });

  it("detects options from JSON with options array", () => {
    const output = JSON.stringify({ options: [{ id: "a", title: "Approach A" }] });
    expect(detectInteractionType(output, "auto")).toBe("options");
  });

  it("detects structured from JSON with fields object", () => {
    const output = JSON.stringify({ fields: { title: "PR Title", description: "Details" } });
    expect(detectInteractionType(output, "auto")).toBe("structured");
  });

  it("detects checklist from JSON with items array", () => {
    const output = JSON.stringify({ items: [{ id: "1", text: "Check this", checked: false }] });
    expect(detectInteractionType(output, "auto")).toBe("checklist");
  });

  it("detects research from JSON with only questions array", () => {
    const output = JSON.stringify({ questions: [{ id: "q1", question: "What?" }] });
    expect(detectInteractionType(output, "auto")).toBe("research");
  });

  // Fallback to text
  it("returns text for plain text output", () => {
    expect(detectInteractionType("Just some plain text output", "auto")).toBe("text");
  });

  it("returns text for empty output", () => {
    expect(detectInteractionType("", "auto")).toBe("text");
  });

  it("returns text for non-object JSON", () => {
    expect(detectInteractionType('"just a string"', "auto")).toBe("text");
    expect(detectInteractionType("42", "auto")).toBe("text");
  });

  it("returns text when no hint provided and content is plain text", () => {
    expect(detectInteractionType("hello world")).toBe("text");
  });

  // Priority: findings > research > plan > options
  it("findings takes priority over questions", () => {
    const output = JSON.stringify({
      findings: [{ id: "f1" }],
      questions: [{ id: "q1" }],
    });
    expect(detectInteractionType(output, "auto")).toBe("findings");
  });

  it("research takes priority over plan when both present", () => {
    const output = JSON.stringify({ research: "text", plan: "text" });
    expect(detectInteractionType(output, "auto")).toBe("research");
  });
});
