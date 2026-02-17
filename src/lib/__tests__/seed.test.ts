import { getDefaultStageTemplates } from "../seed";

describe("getDefaultStageTemplates", () => {
  const projectId = "test-project-id";
  const templates = getDefaultStageTemplates(projectId);

  it("returns 8 stage templates", () => {
    expect(templates).toHaveLength(8);
  });

  it("all templates have the correct project_id", () => {
    for (const t of templates) {
      expect(t.project_id).toBe(projectId);
    }
  });

  it("sort orders are 0 through 7", () => {
    const sortOrders = templates.map((t) => t.sort_order);
    expect(sortOrders).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
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
      "PR Preparation",
      "PR Review",
    ]);
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
