import { getDefaultStageTemplates } from "../seed";

describe("getDefaultStageTemplates", () => {
  const projectId = "test-project-id";
  const templates = getDefaultStageTemplates(projectId);

  it("returns 10 stage templates", () => {
    expect(templates).toHaveLength(10);
  });

  it("all templates have the correct project_id", () => {
    for (const t of templates) {
      expect(t.project_id).toBe(projectId);
    }
  });

  it("sort orders are 0 through 9", () => {
    const sortOrders = templates.map((t) => t.sort_order);
    expect(sortOrders).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
  });

  it("each template has the expected name", () => {
    const names = templates.map((t) => t.name);
    expect(names).toEqual([
      "Research",
      "High-Level Approaches",
      "Planning",
      "Implementation",
      "Refinement",
      "Security Review",
      "Documentation",
      "PR Preparation",
      "PR Review",
      "Merge",
    ]);
  });

  it("behavior flags are set correctly", () => {
    const byName = Object.fromEntries(templates.map((t) => [t.name, t]));

    // commits_changes
    expect(byName["Implementation"].commits_changes).toBe(1);
    expect(byName["Refinement"].commits_changes).toBe(1);
    expect(byName["Security Review"].commits_changes).toBe(1);
    expect(byName["Documentation"].commits_changes).toBe(1);
    expect(byName["Research"].commits_changes).toBe(0);
    expect(byName["PR Preparation"].commits_changes).toBe(0);

    // creates_pr
    expect(byName["PR Preparation"].creates_pr).toBe(1);
    expect(byName["Implementation"].creates_pr).toBe(0);

    // is_terminal
    expect(byName["PR Preparation"].is_terminal).toBe(1);
    expect(byName["PR Review"].is_terminal).toBe(1);
    expect(byName["Merge"].is_terminal).toBe(1);
    expect(byName["Implementation"].is_terminal).toBe(0);

    // triggers_stage_selection
    expect(byName["Research"].triggers_stage_selection).toBe(1);
    expect(byName["Implementation"].triggers_stage_selection).toBe(0);

    // commit_prefix
    expect(byName["Implementation"].commit_prefix).toBe("feat");
    expect(byName["Refinement"].commit_prefix).toBe("fix");
    expect(byName["Security Review"].commit_prefix).toBe("fix");
    expect(byName["Documentation"].commit_prefix).toBe("docs");
    expect(byName["Research"].commit_prefix).toBeNull();
  });

  it("all templates have unique IDs", () => {
    const ids = templates.map((t) => t.id);
    const uniqueIds = new Set(ids);
    expect(uniqueIds.size).toBe(templates.length);
  });

  it("gate_rules are valid JSON", () => {
    for (const t of templates) {
      expect(() => JSON.parse(t.gate_rules)).not.toThrow();
    }
  });

  it("output_schema is valid JSON when present", () => {
    for (const t of templates) {
      if (t.output_schema) {
        const schema = t.output_schema;
        expect(() => JSON.parse(schema)).not.toThrow();
      }
    }
  });

  it("allowed_tools is valid JSON when present", () => {
    for (const t of templates) {
      if (t.allowed_tools) {
        const parsed = JSON.parse(t.allowed_tools);
        expect(Array.isArray(parsed)).toBe(true);
      }
    }
  });
});
