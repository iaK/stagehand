import { getDefaultStageTemplates } from "../seed";

describe("getDefaultStageTemplates", () => {
  const projectId = "test-project-id";
  const templates = getDefaultStageTemplates(projectId);

  it("returns 13 stage templates", () => {
    expect(templates).toHaveLength(13);
  });

  it("all templates have the correct project_id", () => {
    for (const t of templates) {
      expect(t.project_id).toBe(projectId);
    }
  });

  it("sort orders are sequential integers", () => {
    const sortOrders = templates.map((t) => t.sort_order);
    expect(sortOrders).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
  });

  it("each template has the expected name", () => {
    const names = templates.map((t) => t.name);
    expect(names).toEqual([
      "Research",
      "Task Splitting",
      "High-Level Approaches",
      "Planning",
      "Second Opinion",
      "Guided Implementation",
      "Implementation",
      "Refinement",
      "Security Review",
      "Documentation",
      "PR Preparation",
      "PR Review",
      "Merge",
    ]);
  });

  it("special stages have correct output formats", () => {
    const byName = Object.fromEntries(templates.map((t) => [t.name, t]));

    expect(byName["Research"].output_format).toBe("research");
    expect(byName["Task Splitting"].output_format).toBe("task_splitting");
    expect(byName["Guided Implementation"].output_format).toBe("interactive_terminal");
    expect(byName["PR Preparation"].output_format).toBe("pr_preparation");
    expect(byName["PR Review"].output_format).toBe("pr_review");
    expect(byName["Merge"].output_format).toBe("merge");
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
