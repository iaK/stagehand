import { create } from "zustand";
import type { Project } from "../lib/types";
import * as repo from "../lib/repositories";

interface ProjectStore {
  projects: Project[];
  archivedProjects: Project[];
  activeProject: Project | null;
  loading: boolean;
  showArchived: boolean;
  loadProjects: () => Promise<void>;
  loadArchivedProjects: () => Promise<void>;
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

  setActiveProject: (project) => set({ activeProject: project }),

  setShowArchived: (show) => {
    set({ showArchived: show });
    if (show) {
      get().loadArchivedProjects();
    }
  },

  addProject: async (name, path) => {
    const project = await repo.createProject(name, path);
    const projects = await repo.listProjects();
    set({ projects, activeProject: project });
    return project;
  },

  removeProject: async (id) => {
    await repo.deleteProject(id);
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
