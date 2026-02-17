import { vi } from "vitest";
import { useGitHubStore } from "../githubStore";

// Mock repositories
vi.mock("../../lib/repositories", () => ({
  setProjectSetting: vi.fn(),
}));

// Mock git functions
vi.mock("../../lib/git", () => ({
  gitRemoteUrl: vi.fn(),
  parseGitRemote: vi.fn(),
  gitDefaultBranch: vi.fn(),
}));

// eslint-disable-next-line @typescript-eslint/consistent-type-imports
const git = await vi.importMock<typeof import("../../lib/git")>("../../lib/git");
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
const repo = await vi.importMock<typeof import("../../lib/repositories")>("../../lib/repositories");

describe("githubStore", () => {
  beforeEach(() => {
    useGitHubStore.setState({
      projectId: null,
      remoteUrl: null,
      repoFullName: null,
      defaultBranch: null,
      loading: false,
      error: null,
    });
  });

  describe("loadForProject", () => {
    it("detects remote and sets state", async () => {
      vi.mocked(git.gitRemoteUrl).mockResolvedValue("git@github.com:owner/repo.git");
      vi.mocked(git.parseGitRemote).mockReturnValue({ owner: "owner", repo: "repo" });
      vi.mocked(git.gitDefaultBranch).mockResolvedValue("main");

      await useGitHubStore.getState().loadForProject("p1", "/path");

      const state = useGitHubStore.getState();
      expect(state.remoteUrl).toBe("git@github.com:owner/repo.git");
      expect(state.repoFullName).toBe("owner/repo");
      expect(state.defaultBranch).toBe("main");
      expect(state.loading).toBe(false);
    });

    it("sets null values when no remote", async () => {
      vi.mocked(git.gitRemoteUrl).mockResolvedValue(null);

      await useGitHubStore.getState().loadForProject("p1", "/path");

      const state = useGitHubStore.getState();
      expect(state.remoteUrl).toBeNull();
      expect(state.repoFullName).toBeNull();
      expect(state.loading).toBe(false);
    });

    it("persists remote info to project settings", async () => {
      vi.mocked(git.gitRemoteUrl).mockResolvedValue("git@github.com:org/app.git");
      vi.mocked(git.parseGitRemote).mockReturnValue({ owner: "org", repo: "app" });
      vi.mocked(git.gitDefaultBranch).mockResolvedValue("develop");

      await useGitHubStore.getState().loadForProject("p1", "/path");

      expect(repo.setProjectSetting).toHaveBeenCalledWith("p1", "github_repo_owner", "org");
      expect(repo.setProjectSetting).toHaveBeenCalledWith("p1", "github_repo_name", "app");
      expect(repo.setProjectSetting).toHaveBeenCalledWith("p1", "github_repo_full_name", "org/app");
      expect(repo.setProjectSetting).toHaveBeenCalledWith("p1", "github_default_branch", "develop");
    });

    it("defaults branch to main when gitDefaultBranch returns null", async () => {
      vi.mocked(git.gitRemoteUrl).mockResolvedValue("git@github.com:owner/repo.git");
      vi.mocked(git.parseGitRemote).mockReturnValue({ owner: "owner", repo: "repo" });
      vi.mocked(git.gitDefaultBranch).mockResolvedValue(null);

      await useGitHubStore.getState().loadForProject("p1", "/path");

      expect(useGitHubStore.getState().defaultBranch).toBe("main");
    });

    it("sets error on failure", async () => {
      vi.mocked(git.gitRemoteUrl).mockRejectedValue(new Error("git not found"));

      await useGitHubStore.getState().loadForProject("p1", "/path");

      expect(useGitHubStore.getState().error).toBe("git not found");
      expect(useGitHubStore.getState().loading).toBe(false);
    });

    it("ignores result if project changed during async work", async () => {
      vi.mocked(git.gitRemoteUrl).mockImplementation(async () => {
        // Simulate project switch during async work
        useGitHubStore.setState({ projectId: "p2" });
        return "git@github.com:owner/repo.git";
      });
      vi.mocked(git.parseGitRemote).mockReturnValue({ owner: "owner", repo: "repo" });
      vi.mocked(git.gitDefaultBranch).mockResolvedValue("main");

      await useGitHubStore.getState().loadForProject("p1", "/path");

      // State should not have been updated since projectId changed
      expect(useGitHubStore.getState().remoteUrl).toBeNull();
    });
  });

  describe("refresh", () => {
    it("re-detects remote and updates state", async () => {
      vi.mocked(git.gitRemoteUrl).mockResolvedValue("git@github.com:owner/repo.git");
      vi.mocked(git.parseGitRemote).mockReturnValue({ owner: "owner", repo: "repo" });
      vi.mocked(git.gitDefaultBranch).mockResolvedValue("main");

      useGitHubStore.setState({ projectId: "p1" });
      await useGitHubStore.getState().refresh("p1", "/path");

      expect(useGitHubStore.getState().remoteUrl).toBe("git@github.com:owner/repo.git");
      expect(useGitHubStore.getState().loading).toBe(false);
    });

    it("sets error on failure", async () => {
      vi.mocked(git.gitRemoteUrl).mockRejectedValue(new Error("failed"));

      useGitHubStore.setState({ projectId: "p1" });
      await useGitHubStore.getState().refresh("p1", "/path");

      expect(useGitHubStore.getState().error).toBe("failed");
    });
  });
});
