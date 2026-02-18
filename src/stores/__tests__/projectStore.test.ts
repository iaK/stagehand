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
  getProjectTaskSummary: vi.fn(),
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
      projectStatuses: {},
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

  describe("loadProjectStatuses", () => {
    it("populates projectStatuses with aggregate dot classes", async () => {
      const projectA = makeProject({ name: "A" });
      const projectB = makeProject({ name: "B" });
      useProjectStore.setState({ projects: [projectA, projectB] });

      vi.mocked(repo.getProjectTaskSummary)
        .mockResolvedValueOnce({ taskStatuses: ["completed", "in_progress"], execStatuses: ["running"] })
        .mockResolvedValueOnce({ taskStatuses: ["pending"], execStatuses: ["awaiting_user"] });

      await useProjectStore.getState().loadProjectStatuses();

      const statuses = useProjectStore.getState().projectStatuses;
      // Project A: running (urgency 4) beats in_progress (3) and completed (0)
      expect(statuses[projectA.id]).toBe("bg-blue-500 animate-pulse");
      // Project B: awaiting_user (urgency 6) beats pending (2)
      expect(statuses[projectB.id]).toBe("bg-amber-500");
    });

    it("returns gray for projects with no tasks", async () => {
      const project = makeProject({ name: "Empty" });
      useProjectStore.setState({ projects: [project] });

      vi.mocked(repo.getProjectTaskSummary).mockResolvedValueOnce({
        taskStatuses: [],
        execStatuses: [],
      });

      await useProjectStore.getState().loadProjectStatuses();

      expect(useProjectStore.getState().projectStatuses[project.id]).toBe("bg-zinc-400");
    });

    it("gracefully degrades to gray when a project query fails", async () => {
      const projectA = makeProject({ name: "A" });
      const projectB = makeProject({ name: "B" });
      useProjectStore.setState({ projects: [projectA, projectB] });

      vi.mocked(repo.getProjectTaskSummary)
        .mockRejectedValueOnce(new Error("DB corrupted"))
        .mockResolvedValueOnce({ taskStatuses: ["in_progress"], execStatuses: ["awaiting_user"] });

      await useProjectStore.getState().loadProjectStatuses();

      const statuses = useProjectStore.getState().projectStatuses;
      // Failed project falls back to gray
      expect(statuses[projectA.id]).toBe("bg-zinc-400");
      // Successful project still gets its correct status
      expect(statuses[projectB.id]).toBe("bg-amber-500");
    });
  });
});
