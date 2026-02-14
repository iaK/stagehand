import { create } from "zustand";
import type { Project } from "../lib/types";
import * as repo from "../lib/repositories";

interface ProjectStore {
  projects: Project[];
  activeProject: Project | null;
  loading: boolean;
  loadProjects: () => Promise<void>;
  setActiveProject: (project: Project | null) => void;
  addProject: (name: string, path: string) => Promise<Project>;
  removeProject: (id: string) => Promise<void>;
}

export const useProjectStore = create<ProjectStore>((set, get) => ({
  projects: [],
  activeProject: null,
  loading: false,

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

  setActiveProject: (project) => set({ activeProject: project }),

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
}));
