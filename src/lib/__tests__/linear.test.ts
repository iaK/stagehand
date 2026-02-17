import { vi } from "vitest";
import { verifyApiKey, fetchMyIssues, fetchIssueDetail } from "../linear";

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

afterEach(() => {
  mockFetch.mockReset();
});

describe("verifyApiKey", () => {
  it("returns valid result on successful response", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        data: {
          viewer: {
            name: "Alice",
            organization: { id: "org-1", name: "Acme" },
          },
        },
      }),
    });

    const result = await verifyApiKey("lin_api_test");
    expect(result).toEqual({
      valid: true,
      name: "Alice",
      orgName: "Acme",
    });
  });

  it("returns invalid with error on 401", async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 401,
    });

    const result = await verifyApiKey("bad_key");
    expect(result.valid).toBe(false);
    expect(result.error).toBe("Invalid API key");
  });

  it("returns invalid with error on other HTTP errors", async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 500,
    });

    const result = await verifyApiKey("bad_key");
    expect(result.valid).toBe(false);
    expect(result.error).toBe("Linear API error: 500");
  });

  it("returns invalid with error on GraphQL errors", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        errors: [{ message: "Something went wrong" }],
      }),
    });

    const result = await verifyApiKey("bad_key");
    expect(result.valid).toBe(false);
    expect(result.error).toBe("Something went wrong");
  });
});

describe("fetchMyIssues", () => {
  it("maps response correctly", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        data: {
          viewer: {
            assignedIssues: {
              nodes: [
                {
                  id: "issue-1",
                  identifier: "ENG-123",
                  title: "Fix bug",
                  description: "There is a bug",
                  priority: 1,
                  url: "https://linear.app/issue/ENG-123",
                  state: { name: "In Progress" },
                  branchName: "feature/fix-bug",
                },
                {
                  id: "issue-2",
                  identifier: "ENG-456",
                  title: "Add feature",
                  description: null,
                  priority: 2,
                  url: "https://linear.app/issue/ENG-456",
                  state: null,
                  branchName: null,
                },
              ],
            },
          },
        },
      }),
    });

    const issues = await fetchMyIssues("lin_api_test");
    expect(issues).toHaveLength(2);
    expect(issues[0]).toEqual({
      id: "issue-1",
      identifier: "ENG-123",
      title: "Fix bug",
      description: "There is a bug",
      status: "In Progress",
      priority: 1,
      url: "https://linear.app/issue/ENG-123",
      branchName: "feature/fix-bug",
    });
    expect(issues[1].description).toBeUndefined();
    expect(issues[1].status).toBe("Unknown");
    expect(issues[1].branchName).toBeUndefined();
  });
});

describe("fetchIssueDetail", () => {
  it("maps description and comments correctly", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        data: {
          issue: {
            description: "Full description here",
            comments: {
              nodes: [
                {
                  body: "Great work!",
                  user: { name: "Bob" },
                  createdAt: "2025-01-01T00:00:00Z",
                },
                {
                  body: "Needs changes",
                  user: null,
                  createdAt: "2025-01-02T00:00:00Z",
                },
              ],
            },
          },
        },
      }),
    });

    const detail = await fetchIssueDetail("lin_api_test", "issue-1");
    expect(detail.description).toBe("Full description here");
    expect(detail.comments).toEqual([
      "Bob: Great work!",
      "Unknown: Needs changes",
    ]);
  });

  it("handles null description", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        data: {
          issue: {
            description: null,
            comments: { nodes: [] },
          },
        },
      }),
    });

    const detail = await fetchIssueDetail("lin_api_test", "issue-1");
    expect(detail.description).toBeUndefined();
    expect(detail.comments).toEqual([]);
  });
});
