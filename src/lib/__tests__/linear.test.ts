import { vi } from "vitest";

// Mock retry constants to use tiny delays for fast tests
vi.mock("../constants", async (importOriginal) => {
  const original = await importOriginal<typeof import("../constants")>();
  return {
    ...original,
    RETRY_BASE_DELAY_MS: 1,
    RETRY_MAX_DELAY_MS: 2,
  };
});

import { verifyApiKey, fetchMyIssues, fetchIssueDetail, fetchTeams, fetchProjects } from "../linear";

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
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it("returns invalid with error on other HTTP errors", async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 500,
    });

    const result = await verifyApiKey("bad_key");
    expect(result.valid).toBe(false);
    expect(result.error).toBe("Linear API error: 500");
    expect(mockFetch).toHaveBeenCalledTimes(3);
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
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it("returns invalid with error on network failure (fetch throws)", async () => {
    mockFetch.mockImplementation(async () => {
      throw new TypeError("Failed to fetch");
    });

    const result = await verifyApiKey("key");
    expect(result.valid).toBe(false);
    expect(result.error).toBe("Failed to fetch");
    expect(mockFetch).toHaveBeenCalledTimes(3);
  });

  it("retries on 429 and succeeds on second attempt", async () => {
    mockFetch
      .mockResolvedValueOnce({ ok: false, status: 429 })
      .mockResolvedValueOnce({
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
    expect(result.valid).toBe(true);
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

});

describe("fetchTeams", () => {
  it("returns teams from viewer", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        data: {
          viewer: {
            teams: {
              nodes: [
                { id: "team-1", name: "Engineering", key: "ENG" },
                { id: "team-2", name: "Design", key: "DES" },
              ],
            },
          },
        },
      }),
    });

    const teams = await fetchTeams("lin_api_test");
    expect(teams).toEqual([
      { id: "team-1", name: "Engineering", key: "ENG" },
      { id: "team-2", name: "Design", key: "DES" },
    ]);
  });
});

describe("fetchProjects", () => {
  it("returns projects for a team", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        data: {
          team: {
            projects: {
              nodes: [
                { id: "proj-1", name: "Project Alpha" },
                { id: "proj-2", name: "Project Beta" },
              ],
            },
          },
        },
      }),
    });

    const projects = await fetchProjects("lin_api_test", "team-1");
    expect(projects).toEqual([
      { id: "proj-1", name: "Project Alpha" },
      { id: "proj-2", name: "Project Beta" },
    ]);
  });

  it("uses parameterized variables for teamId", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        data: {
          team: {
            projects: { nodes: [] },
          },
        },
      }),
    });

    await fetchProjects("lin_api_test", "team-1");

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.variables).toEqual({ teamId: "team-1" });
    expect(body.query).toContain("$teamId: String!");
  });
});

describe("fetchMyIssues", () => {
  const mockPageInfo = { hasNextPage: false, endCursor: null };

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
              pageInfo: mockPageInfo,
            },
          },
        },
      }),
    });

    const result = await fetchMyIssues("lin_api_test");
    expect(result.issues).toHaveLength(2);
    expect(result.issues[0]).toEqual({
      id: "issue-1",
      identifier: "ENG-123",
      title: "Fix bug",
      description: "There is a bug",
      status: "In Progress",
      priority: 1,
      url: "https://linear.app/issue/ENG-123",
      branchName: "feature/fix-bug",
    });
    expect(result.issues[1].description).toBeUndefined();
    expect(result.issues[1].status).toBe("Unknown");
    expect(result.issues[1].branchName).toBeUndefined();
    expect(result.hasNextPage).toBe(false);
    expect(result.endCursor).toBeNull();
  });

  it("uses parameterized GraphQL variables for filters", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        data: {
          viewer: {
            assignedIssues: { nodes: [], pageInfo: mockPageInfo },
          },
        },
      }),
    });

    await fetchMyIssues("lin_api_test", { teamId: "team-1", projectId: "proj-1" });

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.query).toContain("$filter: IssueFilter");
    expect(body.query).toContain("$first: Int!");
    expect(body.variables.filter).toEqual({
      state: { type: { nin: ["completed", "canceled"] } },
      team: { id: { eq: "team-1" } },
      project: { id: { eq: "proj-1" } },
    });
    // Ensure IDs are NOT interpolated into the query string
    expect(body.query).not.toContain("team-1");
    expect(body.query).not.toContain("proj-1");
  });

  it("omits team/project from filter variables when no options provided", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        data: {
          viewer: {
            assignedIssues: { nodes: [], pageInfo: mockPageInfo },
          },
        },
      }),
    });

    await fetchMyIssues("lin_api_test");

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.variables.filter).toEqual({
      state: { type: { nin: ["completed", "canceled"] } },
    });
    expect(body.variables.filter.team).toBeUndefined();
    expect(body.variables.filter.project).toBeUndefined();
  });

  it("passes after cursor for pagination", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        data: {
          viewer: {
            assignedIssues: {
              nodes: [],
              pageInfo: { hasNextPage: false, endCursor: null },
            },
          },
        },
      }),
    });

    await fetchMyIssues("lin_api_test", { after: "cursor-abc" });

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.variables.after).toBe("cursor-abc");
    expect(body.query).toContain("$after: String");
  });

  it("returns pagination info", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        data: {
          viewer: {
            assignedIssues: {
              nodes: [],
              pageInfo: { hasNextPage: true, endCursor: "cursor-xyz" },
            },
          },
        },
      }),
    });

    const result = await fetchMyIssues("lin_api_test");
    expect(result.hasNextPage).toBe(true);
    expect(result.endCursor).toBe("cursor-xyz");
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

  it("uses parameterized variables instead of string interpolation", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        data: {
          issue: {
            description: "desc",
            comments: { nodes: [] },
          },
        },
      }),
    });

    await fetchIssueDetail("lin_api_test", "issue-1");

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.variables).toEqual({ id: "issue-1" });
    expect(body.query).toContain("$id: String!");
    expect(body.query).not.toContain('"issue-1"');
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
