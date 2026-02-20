import { create } from "zustand";
import type { Project } from "../lib/types";
import * as repo from "../lib/repositories";
import { aggregateProjectDotClass } from "../lib/taskStatus";
import { scanRepository } from "../lib/repoScanner";
import { gitRemoteUrl, parseGitRemote, gitDefaultBranch } from "../lib/git";

interface ProjectStore {
  projects: Project[];
  archivedProjects: Project[];
  activeProject: Project | null;
  loading: boolean;
  showArchived: boolean;
  projectStatuses: Record<string, string>;
  loadProjects: () => Promise<void>;
  loadArchivedProjects: () => Promise<void>;
  loadProjectStatuses: () => Promise<void>;
  setActiveProject: (project: Project | null) => void;
  setShowArchived: (show: boolean) => void;
  addProject: (name: string, path: string) => Promise<Project>;
  removeProject: (id: string) => Promise<void>;
  archiveProject: (id: string) => Promise<void>;
  unarchiveProject: (id: string) => Promise<void>;
}

export const useProjectStore = create<ProjectStore>((set, get) => ({
  projects: [],
  archivedProjects: [],
  activeProject: null,
  loading: false,
  showArchived: false,
  projectStatuses: {},

  loadProjects: async () => {
    set({ loading: true });
    const projects = await repo.listProjects();
    const current = get().activeProject;
    set({
      projects,
      loading: false,
      activeProject: current
        ? projects.find((p) => p.id === current.id) ?? projects[0] ?? null
        : projects[0] ?? null,
    });
  },

  loadArchivedProjects: async () => {
    const archivedProjects = await repo.listArchivedProjects();
    set({ archivedProjects });
  },

  // Note: opens a separate SQLite DB per project (N+1). Acceptable for typical
  // usage (few projects) but may lag with 20+ projects.
  loadProjectStatuses: async () => {
    const projects = get().projects;
    const results = await Promise.allSettled(
      projects.map(async (p) => {
        const summary = await repo.getProjectTaskSummary(p.id);
        return [p.id, aggregateProjectDotClass(summary.taskStatuses, summary.execStatuses)] as const;
      }),
    );
    const entries = results.map((r, i) =>
      r.status === "fulfilled" ? r.value : [projects[i].id, "bg-zinc-400"] as const,
    );
    set({ projectStatuses: Object.fromEntries(entries) });
  },

  setActiveProject: (project) => set({ activeProject: project }),

  setShowArchived: (show) => {
    set({ showArchived: show });
    if (show) {
      get().loadArchivedProjects();
    }
  },

  addProject: async (name, path) => {
    const project = await repo.createProject(name, path);

    // Scan repository conventions (runs in background, non-blocking for UI)
    scanRepository(project.id, path).catch(() => {});

    // Auto-detect git remote info (runs in background, non-blocking for UI)
    (async () => {
      const url = await gitRemoteUrl(path);
      if (!url) return;
      const parsed = parseGitRemote(url);
      const branch = await gitDefaultBranch(path);
      if (parsed) {
        await repo.setProjectSetting(project.id, "github_repo_owner", parsed.owner);
        await repo.setProjectSetting(project.id, "github_repo_name", parsed.repo);
        await repo.setProjectSetting(project.id, "github_repo_full_name", `${parsed.owner}/${parsed.repo}`);
      }
      await repo.setProjectSetting(project.id, "github_default_branch", branch ?? "main");
    })().catch(() => {});

    const projects = await repo.listProjects();
    set({ projects, activeProject: project });
    return project;
  },

  removeProject: async (id) => {
    const project = get().projects.find((p) => p.id === id);
    await repo.deleteProject(id, project?.path);
    const projects = await repo.listProjects();
    const current = get().activeProject;
    set({
      projects,
      activeProject:
        current?.id === id ? projects[0] ?? null : current,
    });
  },

  archiveProject: async (id) => {
    await repo.updateProject(id, { archived: 1 });
    const projects = await repo.listProjects();
    const current = get().activeProject;
    const newState: Partial<ProjectStore> = { projects };
    if (current?.id === id) {
      newState.activeProject = projects[0] ?? null;
    }
    if (get().showArchived) {
      newState.archivedProjects = await repo.listArchivedProjects();
    }
    set(newState);
  },

  unarchiveProject: async (id) => {
    await repo.updateProject(id, { archived: 0 });
    const projects = await repo.listProjects();
    const archivedProjects = await repo.listArchivedProjects();
    set({ projects, archivedProjects });
  },
}));
