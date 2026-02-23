import { vi } from "vitest";
import { useLinearStore } from "../linearStore";

// Mock repositories
vi.mock("../../lib/repositories", () => ({
  getProjectSetting: vi.fn(),
  setProjectSetting: vi.fn(),
  deleteProjectSetting: vi.fn(),
}));

// Mock linear API
vi.mock("../../lib/linear", () => ({
  verifyApiKey: vi.fn(),
  fetchMyIssues: vi.fn(),
  fetchTeams: vi.fn(),
  fetchProjects: vi.fn(),
}));

// eslint-disable-next-line @typescript-eslint/consistent-type-imports
const repo = await vi.importMock<typeof import("../../lib/repositories")>("../../lib/repositories");
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
const linear = await vi.importMock<typeof import("../../lib/linear")>("../../lib/linear");

const initialState = {
  projectId: null,
  apiKey: null,
  userName: null,
  orgName: null,
  issues: [],
  loading: false,
  error: null,
  teams: [],
  projects: [],
  selectedTeamId: null,
  selectedTeamName: null,
  selectedProjectId: null,
  selectedProjectName: null,
  teamsLoading: false,
  projectsLoading: false,
};

describe("linearStore", () => {
  beforeEach(() => {
    useLinearStore.setState(initialState);
  });

  describe("loadForProject", () => {
    it("resets state and returns early when no API key stored", async () => {
      vi.mocked(repo.getProjectSetting).mockResolvedValue(null);

      await useLinearStore.getState().loadForProject("p1");

      const state = useLinearStore.getState();
      expect(state.projectId).toBe("p1");
      expect(state.apiKey).toBeNull();
    });

    it("loads and verifies API key when stored", async () => {
      vi.mocked(repo.getProjectSetting).mockResolvedValue("lin_api_key");
      vi.mocked(linear.verifyApiKey).mockResolvedValue({
        valid: true,
        name: "Alice",
        orgName: "Acme",
      });

      await useLinearStore.getState().loadForProject("p1");

      const state = useLinearStore.getState();
      expect(state.apiKey).toBe("lin_api_key");
      expect(state.userName).toBe("Alice");
      expect(state.orgName).toBe("Acme");
    });

    it("clears stored key when verification fails", async () => {
      vi.mocked(repo.getProjectSetting).mockResolvedValue("bad_key");
      vi.mocked(linear.verifyApiKey).mockResolvedValue({
        valid: false,
        name: "",
        orgName: "",
        error: "Invalid",
      });

      await useLinearStore.getState().loadForProject("p1");

      expect(repo.deleteProjectSetting).toHaveBeenCalledWith("p1", "linear_api_key");
      expect(useLinearStore.getState().apiKey).toBeNull();
    });

    it("loads persisted team/project selection", async () => {
      const settingsMap: Record<string, string | null> = {
        linear_api_key: "lin_api_key",
        linear_user_name: "Alice",
        linear_org_name: "Acme",
        linear_team_id: "team-1",
        linear_team_name: "Engineering",
        linear_project_id: "proj-1",
        linear_project_name: "Alpha",
      };
      vi.mocked(repo.getProjectSetting).mockImplementation(async (_pid, key) => settingsMap[key] ?? null);
      vi.mocked(linear.verifyApiKey).mockResolvedValue({
        valid: true,
        name: "Alice",
        orgName: "Acme",
      });

      await useLinearStore.getState().loadForProject("p1");

      const state = useLinearStore.getState();
      expect(state.selectedTeamId).toBe("team-1");
      expect(state.selectedTeamName).toBe("Engineering");
      expect(state.selectedProjectId).toBe("proj-1");
      expect(state.selectedProjectName).toBe("Alpha");
    });
  });

  describe("saveApiKey", () => {
    it("saves key and updates state on valid key", async () => {
      vi.mocked(linear.verifyApiKey).mockResolvedValue({
        valid: true,
        name: "Alice",
        orgName: "Acme",
      });

      const result = await useLinearStore.getState().saveApiKey("p1", "lin_new");

      expect(result).toBe(true);
      expect(repo.setProjectSetting).toHaveBeenCalledWith("p1", "linear_api_key", "lin_new");
      expect(useLinearStore.getState().apiKey).toBe("lin_new");
      expect(useLinearStore.getState().loading).toBe(false);
    });

    it("returns false and sets error on invalid key", async () => {
      vi.mocked(linear.verifyApiKey).mockResolvedValue({
        valid: false,
        name: "",
        orgName: "",
        error: "Bad key",
      });

      const result = await useLinearStore.getState().saveApiKey("p1", "bad");

      expect(result).toBe(false);
      expect(useLinearStore.getState().error).toBe("Bad key");
      expect(useLinearStore.getState().loading).toBe(false);
    });

    it("handles thrown errors", async () => {
      vi.mocked(linear.verifyApiKey).mockRejectedValue(new Error("Network fail"));

      const result = await useLinearStore.getState().saveApiKey("p1", "key");

      expect(result).toBe(false);
      expect(useLinearStore.getState().error).toBe("Network fail");
    });
  });

  describe("disconnect", () => {
    it("clears API key, team/project selection, and state", async () => {
      useLinearStore.setState({
        apiKey: "key", userName: "Alice", orgName: "Acme",
        selectedTeamId: "team-1", selectedTeamName: "Eng",
        selectedProjectId: "proj-1", selectedProjectName: "Alpha",
      });

      await useLinearStore.getState().disconnect("p1");

      expect(repo.deleteProjectSetting).toHaveBeenCalledWith("p1", "linear_api_key");
      expect(repo.deleteProjectSetting).toHaveBeenCalledWith("p1", "linear_team_id");
      expect(repo.deleteProjectSetting).toHaveBeenCalledWith("p1", "linear_team_name");
      expect(repo.deleteProjectSetting).toHaveBeenCalledWith("p1", "linear_project_id");
      expect(repo.deleteProjectSetting).toHaveBeenCalledWith("p1", "linear_project_name");
      expect(useLinearStore.getState().apiKey).toBeNull();
      expect(useLinearStore.getState().selectedTeamId).toBeNull();
      expect(useLinearStore.getState().selectedProjectId).toBeNull();
    });
  });

  describe("fetchTeams", () => {
    it("fetches and stores teams", async () => {
      const teams = [
        { id: "team-1", name: "Engineering", key: "ENG" },
        { id: "team-2", name: "Design", key: "DES" },
      ];
      useLinearStore.setState({ apiKey: "key" });
      vi.mocked(linear.fetchTeams).mockResolvedValue(teams);

      await useLinearStore.getState().fetchTeams();

      expect(useLinearStore.getState().teams).toEqual(teams);
      expect(useLinearStore.getState().teamsLoading).toBe(false);
    });

    it("does nothing when no API key", async () => {
      useLinearStore.setState({ apiKey: null });

      await useLinearStore.getState().fetchTeams();

      expect(linear.fetchTeams).not.toHaveBeenCalled();
    });

    it("sets error on failure", async () => {
      useLinearStore.setState({ apiKey: "key" });
      vi.mocked(linear.fetchTeams).mockRejectedValue(new Error("Failed"));

      await useLinearStore.getState().fetchTeams();

      expect(useLinearStore.getState().error).toBe("Failed");
      expect(useLinearStore.getState().teamsLoading).toBe(false);
    });
  });

  describe("fetchProjects", () => {
    it("fetches and stores projects for a team", async () => {
      const projects = [
        { id: "proj-1", name: "Alpha" },
        { id: "proj-2", name: "Beta" },
      ];
      useLinearStore.setState({ apiKey: "key" });
      vi.mocked(linear.fetchProjects).mockResolvedValue(projects);

      await useLinearStore.getState().fetchProjects("team-1");

      expect(linear.fetchProjects).toHaveBeenCalledWith("key", "team-1");
      expect(useLinearStore.getState().projects).toEqual(projects);
      expect(useLinearStore.getState().projectsLoading).toBe(false);
    });

    it("sets error on failure", async () => {
      useLinearStore.setState({ apiKey: "key" });
      vi.mocked(linear.fetchProjects).mockRejectedValue(new Error("Failed"));

      await useLinearStore.getState().fetchProjects("team-1");

      expect(useLinearStore.getState().error).toBe("Failed");
      expect(useLinearStore.getState().projectsLoading).toBe(false);
    });
  });

  describe("selectTeam", () => {
    it("persists team selection and clears project", async () => {
      useLinearStore.setState({
        selectedProjectId: "proj-1",
        selectedProjectName: "Alpha",
        projects: [{ id: "proj-1", name: "Alpha" }],
      });

      await useLinearStore.getState().selectTeam("p1", "team-2", "Design");

      expect(repo.setProjectSetting).toHaveBeenCalledWith("p1", "linear_team_id", "team-2");
      expect(repo.setProjectSetting).toHaveBeenCalledWith("p1", "linear_team_name", "Design");
      expect(repo.deleteProjectSetting).toHaveBeenCalledWith("p1", "linear_project_id");
      expect(repo.deleteProjectSetting).toHaveBeenCalledWith("p1", "linear_project_name");

      const state = useLinearStore.getState();
      expect(state.selectedTeamId).toBe("team-2");
      expect(state.selectedTeamName).toBe("Design");
      expect(state.selectedProjectId).toBeNull();
      expect(state.selectedProjectName).toBeNull();
      expect(state.projects).toEqual([]);
    });
  });

  describe("selectProject", () => {
    it("persists project selection", async () => {
      await useLinearStore.getState().selectProject("p1", "proj-1", "Alpha");

      expect(repo.setProjectSetting).toHaveBeenCalledWith("p1", "linear_project_id", "proj-1");
      expect(repo.setProjectSetting).toHaveBeenCalledWith("p1", "linear_project_name", "Alpha");
      expect(useLinearStore.getState().selectedProjectId).toBe("proj-1");
      expect(useLinearStore.getState().selectedProjectName).toBe("Alpha");
    });

    it("clears project selection when null", async () => {
      useLinearStore.setState({ selectedProjectId: "proj-1", selectedProjectName: "Alpha" });

      await useLinearStore.getState().selectProject("p1", null, null);

      expect(repo.deleteProjectSetting).toHaveBeenCalledWith("p1", "linear_project_id");
      expect(repo.deleteProjectSetting).toHaveBeenCalledWith("p1", "linear_project_name");
      expect(useLinearStore.getState().selectedProjectId).toBeNull();
    });
  });

  describe("fetchIssues", () => {
    it("fetches and stores issues with filters", async () => {
      const issues = [{ id: "i1", identifier: "ENG-1", title: "Bug", description: undefined, status: "Todo", priority: 1, url: "url", branchName: undefined }];
      useLinearStore.setState({ apiKey: "key", selectedTeamId: "team-1", selectedProjectId: "proj-1" });
      vi.mocked(linear.fetchMyIssues).mockResolvedValue(issues);

      await useLinearStore.getState().fetchIssues();

      expect(linear.fetchMyIssues).toHaveBeenCalledWith("key", { teamId: "team-1", projectId: "proj-1" });
      expect(useLinearStore.getState().issues).toEqual(issues);
      expect(useLinearStore.getState().loading).toBe(false);
    });

    it("passes undefined filters when no team/project selected", async () => {
      useLinearStore.setState({ apiKey: "key" });
      vi.mocked(linear.fetchMyIssues).mockResolvedValue([]);

      await useLinearStore.getState().fetchIssues();

      expect(linear.fetchMyIssues).toHaveBeenCalledWith("key", { teamId: undefined, projectId: undefined });
    });

    it("does nothing when no API key", async () => {
      useLinearStore.setState({ apiKey: null });

      await useLinearStore.getState().fetchIssues();

      expect(linear.fetchMyIssues).not.toHaveBeenCalled();
    });

    it("sets error on failure", async () => {
      useLinearStore.setState({ apiKey: "key" });
      vi.mocked(linear.fetchMyIssues).mockRejectedValue(new Error("Failed"));

      await useLinearStore.getState().fetchIssues();

      expect(useLinearStore.getState().error).toBe("Failed");
      expect(useLinearStore.getState().loading).toBe(false);
    });
  });

  describe("reset", () => {
    it("resets all state including team/project", () => {
      useLinearStore.setState({
        apiKey: "key", userName: "Alice", loading: true,
        selectedTeamId: "team-1", selectedTeamName: "Eng",
        teams: [{ id: "team-1", name: "Eng", key: "ENG" }],
      });
      useLinearStore.getState().reset();

      const state = useLinearStore.getState();
      expect(state.apiKey).toBeNull();
      expect(state.userName).toBeNull();
      expect(state.loading).toBe(false);
      expect(state.selectedTeamId).toBeNull();
      expect(state.teams).toEqual([]);
    });
  });

  describe("clearError", () => {
    it("clears the error", () => {
      useLinearStore.setState({ error: "some error" });
      useLinearStore.getState().clearError();
      expect(useLinearStore.getState().error).toBeNull();
    });
  });
});
