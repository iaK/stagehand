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
}));

// eslint-disable-next-line @typescript-eslint/consistent-type-imports
const repo = await vi.importMock<typeof import("../../lib/repositories")>("../../lib/repositories");
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
const linear = await vi.importMock<typeof import("../../lib/linear")>("../../lib/linear");

describe("linearStore", () => {
  beforeEach(() => {
    useLinearStore.setState({
      projectId: null,
      apiKey: null,
      userName: null,
      orgName: null,
      issues: [],
      loading: false,
      error: null,
    });
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
    it("clears API key and state", async () => {
      useLinearStore.setState({ apiKey: "key", userName: "Alice", orgName: "Acme" });

      await useLinearStore.getState().disconnect("p1");

      expect(repo.deleteProjectSetting).toHaveBeenCalledWith("p1", "linear_api_key");
      expect(useLinearStore.getState().apiKey).toBeNull();
      expect(useLinearStore.getState().userName).toBeNull();
    });
  });

  describe("fetchIssues", () => {
    it("fetches and stores issues", async () => {
      const issues = [{ id: "i1", identifier: "ENG-1", title: "Bug", description: undefined, status: "Todo", priority: 1, url: "url", branchName: undefined }];
      useLinearStore.setState({ apiKey: "key" });
      vi.mocked(linear.fetchMyIssues).mockResolvedValue(issues);

      await useLinearStore.getState().fetchIssues();

      expect(useLinearStore.getState().issues).toEqual(issues);
      expect(useLinearStore.getState().loading).toBe(false);
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
    it("resets all state", () => {
      useLinearStore.setState({ apiKey: "key", userName: "Alice", loading: true });
      useLinearStore.getState().reset();

      const state = useLinearStore.getState();
      expect(state.apiKey).toBeNull();
      expect(state.userName).toBeNull();
      expect(state.loading).toBe(false);
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
