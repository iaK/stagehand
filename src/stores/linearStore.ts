import { create } from "zustand";
import type { LinearIssue } from "../lib/types";
import type { LinearTeam, LinearProject } from "../lib/linear";
import * as repo from "../lib/repositories";
import * as linear from "../lib/linear";

const KEY_API = "linear_api_key";
const KEY_USER = "linear_user_name";
const KEY_ORG = "linear_org_name";
const KEY_TEAM_ID = "linear_team_id";
const KEY_TEAM_NAME = "linear_team_name";
const KEY_PROJECT_ID = "linear_project_id";
const KEY_PROJECT_NAME = "linear_project_name";

interface LinearStore {
  projectId: string | null;
  apiKey: string | null;
  userName: string | null;
  orgName: string | null;
  issues: LinearIssue[];
  loading: boolean;
  error: string | null;

  // Team/project filter state
  teams: LinearTeam[];
  projects: LinearProject[];
  selectedTeamId: string | null;
  selectedTeamName: string | null;
  selectedProjectId: string | null;
  selectedProjectName: string | null;
  teamsLoading: boolean;
  projectsLoading: boolean;

  // Pagination state
  hasNextPage: boolean;
  endCursor: string | null;
  loadingMore: boolean;
  /** Incremented on each filter change to discard stale responses */
  fetchVersion: number;

  loadForProject: (projectId: string) => Promise<void>;
  saveApiKey: (projectId: string, key: string) => Promise<boolean>;
  disconnect: (projectId: string) => Promise<void>;
  fetchIssues: () => Promise<void>;
  fetchMoreIssues: () => Promise<void>;
  fetchTeams: () => Promise<void>;
  fetchProjects: (teamId: string) => Promise<void>;
  selectTeam: (projectId: string, teamId: string | null, teamName: string | null) => Promise<void>;
  selectProject: (projectId: string, linearProjectId: string | null, projectName: string | null) => Promise<void>;
  reset: () => void;
  clearError: () => void;
}

export const useLinearStore = create<LinearStore>((set, get) => ({
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
  hasNextPage: false,
  endCursor: null,
  loadingMore: false,
  fetchVersion: 0,

  loadForProject: async (projectId: string) => {
    // Reset immediately to prevent stale data flash
    set({
      projectId, apiKey: null, userName: null, orgName: null,
      issues: [], error: null,
      teams: [], projects: [],
      selectedTeamId: null, selectedTeamName: null,
      selectedProjectId: null, selectedProjectName: null,
    });

    const apiKey = await repo.getProjectSetting(projectId, KEY_API);
    if (!apiKey) return;

    // Guard against project switch during async work
    if (get().projectId !== projectId) return;

    set({ apiKey });

    const result = await linear.verifyApiKey(apiKey);
    if (get().projectId !== projectId) return;

    if (result.valid) {
      set({ userName: result.name, orgName: result.orgName });
      // Persist names in case they changed on Linear's side
      await repo.setProjectSetting(projectId, KEY_USER, result.name);
      await repo.setProjectSetting(projectId, KEY_ORG, result.orgName);

      // Load persisted team/project selection
      const teamId = await repo.getProjectSetting(projectId, KEY_TEAM_ID);
      const teamName = await repo.getProjectSetting(projectId, KEY_TEAM_NAME);
      const projId = await repo.getProjectSetting(projectId, KEY_PROJECT_ID);
      const projName = await repo.getProjectSetting(projectId, KEY_PROJECT_NAME);
      if (get().projectId !== projectId) return;

      if (teamId && teamName) {
        set({
          selectedTeamId: teamId,
          selectedTeamName: teamName,
          selectedProjectId: projId,
          selectedProjectName: projName,
        });
      }
    } else {
      // Key is stored but invalid — clear it
      await repo.deleteProjectSetting(projectId, KEY_API);
      await repo.deleteProjectSetting(projectId, KEY_USER);
      await repo.deleteProjectSetting(projectId, KEY_ORG);
      set({ apiKey: null, userName: null, orgName: null });
    }
  },

  saveApiKey: async (projectId: string, key: string) => {
    set({ loading: true, error: null });
    try {
      const result = await linear.verifyApiKey(key);
      if (!result.valid) {
        set({ loading: false, error: result.error ?? "Invalid API key" });
        return false;
      }
      await repo.setProjectSetting(projectId, KEY_API, key);
      await repo.setProjectSetting(projectId, KEY_USER, result.name);
      await repo.setProjectSetting(projectId, KEY_ORG, result.orgName);
      set({
        apiKey: key,
        userName: result.name,
        orgName: result.orgName,
        loading: false,
      });
      return true;
    } catch (e) {
      set({
        loading: false,
        error: e instanceof Error ? e.message : "Failed to save API key",
      });
      return false;
    }
  },

  disconnect: async (projectId: string) => {
    await repo.deleteProjectSetting(projectId, KEY_API);
    await repo.deleteProjectSetting(projectId, KEY_USER);
    await repo.deleteProjectSetting(projectId, KEY_ORG);
    await repo.deleteProjectSetting(projectId, KEY_TEAM_ID);
    await repo.deleteProjectSetting(projectId, KEY_TEAM_NAME);
    await repo.deleteProjectSetting(projectId, KEY_PROJECT_ID);
    await repo.deleteProjectSetting(projectId, KEY_PROJECT_NAME);
    set({
      apiKey: null, userName: null, orgName: null,
      issues: [], error: null,
      teams: [], projects: [],
      selectedTeamId: null, selectedTeamName: null,
      selectedProjectId: null, selectedProjectName: null,
      hasNextPage: false, endCursor: null, loadingMore: false,
    });
  },

  fetchTeams: async () => {
    const { apiKey } = get();
    if (!apiKey) return;
    set({ teamsLoading: true });
    try {
      const teams = await linear.fetchTeams(apiKey);
      set({ teams, teamsLoading: false });
    } catch (e) {
      set({
        teamsLoading: false,
        error: e instanceof Error ? e.message : "Failed to fetch teams",
      });
    }
  },

  fetchProjects: async (teamId: string) => {
    const { apiKey } = get();
    if (!apiKey) return;
    set({ projectsLoading: true });
    try {
      const projects = await linear.fetchProjects(apiKey, teamId);
      set({ projects, projectsLoading: false });
    } catch (e) {
      set({
        projectsLoading: false,
        error: e instanceof Error ? e.message : "Failed to fetch projects",
      });
    }
  },

  selectTeam: async (projectId: string, teamId: string | null, teamName: string | null) => {
    // Clear project selection when team changes
    set({
      selectedTeamId: teamId,
      selectedTeamName: teamName,
      selectedProjectId: null,
      selectedProjectName: null,
      projects: [],
    });
    if (teamId && teamName) {
      await repo.setProjectSetting(projectId, KEY_TEAM_ID, teamId);
      await repo.setProjectSetting(projectId, KEY_TEAM_NAME, teamName);
    } else {
      await repo.deleteProjectSetting(projectId, KEY_TEAM_ID);
      await repo.deleteProjectSetting(projectId, KEY_TEAM_NAME);
    }
    await repo.deleteProjectSetting(projectId, KEY_PROJECT_ID);
    await repo.deleteProjectSetting(projectId, KEY_PROJECT_NAME);
  },

  selectProject: async (projectId: string, linearProjectId: string | null, projectName: string | null) => {
    set({
      selectedProjectId: linearProjectId,
      selectedProjectName: projectName,
    });
    if (linearProjectId && projectName) {
      await repo.setProjectSetting(projectId, KEY_PROJECT_ID, linearProjectId);
      await repo.setProjectSetting(projectId, KEY_PROJECT_NAME, projectName);
    } else {
      await repo.deleteProjectSetting(projectId, KEY_PROJECT_ID);
      await repo.deleteProjectSetting(projectId, KEY_PROJECT_NAME);
    }
  },

  fetchIssues: async () => {
    const { apiKey, selectedTeamId, selectedProjectId } = get();
    if (!apiKey) return;
    const version = get().fetchVersion + 1;
    set({ loading: true, error: null, issues: [], hasNextPage: false, endCursor: null, fetchVersion: version });
    try {
      const result = await linear.fetchMyIssues(apiKey, {
        teamId: selectedTeamId ?? undefined,
        projectId: selectedProjectId ?? undefined,
      });
      // Discard stale response if filters changed while loading
      if (get().fetchVersion !== version) return;
      set({ issues: result.issues, hasNextPage: result.hasNextPage, endCursor: result.endCursor, loading: false });
    } catch (e) {
      if (get().fetchVersion !== version) return;
      set({
        loading: false,
        error: e instanceof Error ? e.message : "Failed to fetch issues",
      });
    }
  },

  fetchMoreIssues: async () => {
    const { apiKey, selectedTeamId, selectedProjectId, endCursor, hasNextPage, loadingMore, fetchVersion } = get();
    if (!apiKey || !hasNextPage || !endCursor || loadingMore) return;
    set({ loadingMore: true });
    try {
      const result = await linear.fetchMyIssues(apiKey, {
        teamId: selectedTeamId ?? undefined,
        projectId: selectedProjectId ?? undefined,
        after: endCursor,
      });
      // Discard stale response if filters changed while loading
      if (get().fetchVersion !== fetchVersion) return;
      set((state) => ({
        issues: [...state.issues, ...result.issues],
        hasNextPage: result.hasNextPage,
        endCursor: result.endCursor,
        loadingMore: false,
      }));
    } catch (e) {
      if (get().fetchVersion !== fetchVersion) return;
      set({
        loadingMore: false,
        error: e instanceof Error ? e.message : "Failed to load more issues",
      });
    }
  },

  reset: () => {
    set({
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
      hasNextPage: false,
      endCursor: null,
      loadingMore: false,
      fetchVersion: 0,
    });
  },

  clearError: () => set({ error: null }),
}));
