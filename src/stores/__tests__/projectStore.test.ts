import { vi } from "vitest";
import { useProjectStore } from "../projectStore";
import { makeProject } from "../../test/fixtures";

// Mock the repositories module
vi.mock("../../lib/repositories", () => ({
  listProjects: vi.fn(),
  listArchivedProjects: vi.fn(),
  createProject: vi.fn(),
  deleteProject: vi.fn(),
  updateProject: vi.fn(),
  setProjectSetting: vi.fn(),
}));

// Mock repoScanner
vi.mock("../../lib/repoScanner", () => ({
  scanRepository: vi.fn().mockResolvedValue(""),
}));

// Mock git functions
vi.mock("../../lib/git", () => ({
  gitRemoteUrl: vi.fn().mockResolvedValue(null),
  parseGitRemote: vi.fn().mockReturnValue(null),
  gitDefaultBranch: vi.fn().mockResolvedValue(null),
}));

// eslint-disable-next-line @typescript-eslint/consistent-type-imports
const repo = await vi.importMock<typeof import("../../lib/repositories")>("../../lib/repositories");

describe("projectStore", () => {
  beforeEach(() => {
    // Reset the store state
    useProjectStore.setState({
      projects: [],
      archivedProjects: [],
      activeProject: null,
      loading: false,
      showArchived: false,
    });
  });

  describe("loadProjects", () => {
    it("calls listProjects and sets state", async () => {
      const projects = [makeProject({ name: "Project A" }), makeProject({ name: "Project B" })];
      vi.mocked(repo.listProjects).mockResolvedValue(projects);

      await useProjectStore.getState().loadProjects();

      const state = useProjectStore.getState();
      expect(state.projects).toEqual(projects);
      expect(state.loading).toBe(false);
      expect(state.activeProject).toEqual(projects[0]);
    });

    it("preserves active project if still in list", async () => {
      const projectA = makeProject({ name: "A" });
      const projectB = makeProject({ name: "B" });
      useProjectStore.setState({ activeProject: projectA });

      vi.mocked(repo.listProjects).mockResolvedValue([projectA, projectB]);

      await useProjectStore.getState().loadProjects();

      expect(useProjectStore.getState().activeProject).toEqual(projectA);
    });

    it("falls back to first project if active project removed", async () => {
      const oldProject = makeProject({ name: "Old" });
      const newProject = makeProject({ name: "New" });
      useProjectStore.setState({ activeProject: oldProject });

      vi.mocked(repo.listProjects).mockResolvedValue([newProject]);

      await useProjectStore.getState().loadProjects();

      expect(useProjectStore.getState().activeProject).toEqual(newProject);
    });
  });

  describe("addProject", () => {
    it("calls createProject and updates state", async () => {
      const newProject = makeProject({ name: "New Project" });
      vi.mocked(repo.createProject).mockResolvedValue(newProject);
      vi.mocked(repo.listProjects).mockResolvedValue([newProject]);

      const result = await useProjectStore.getState().addProject("New Project", "/path");

      expect(repo.createProject).toHaveBeenCalledWith("New Project", "/path");
      expect(result).toEqual(newProject);
      expect(useProjectStore.getState().activeProject).toEqual(newProject);
      expect(useProjectStore.getState().projects).toEqual([newProject]);
    });
  });

  describe("archiveProject", () => {
    it("calls updateProject and removes from list", async () => {
      const projectA = makeProject({ name: "A" });
      const projectB = makeProject({ name: "B" });
      useProjectStore.setState({ projects: [projectA, projectB], activeProject: projectA });

      vi.mocked(repo.updateProject).mockResolvedValue(undefined);
      vi.mocked(repo.listProjects).mockResolvedValue([projectB]);

      await useProjectStore.getState().archiveProject(projectA.id);

      expect(repo.updateProject).toHaveBeenCalledWith(projectA.id, { archived: 1 });
      expect(useProjectStore.getState().projects).toEqual([projectB]);
      // Active project should switch since the archived one was active
      expect(useProjectStore.getState().activeProject).toEqual(projectB);
    });
  });
});
