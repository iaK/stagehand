import { create } from "zustand";
import type { LinearIssue } from "../lib/types";
import * as repo from "../lib/repositories";
import * as linear from "../lib/linear";

const KEY_API = "linear_api_key";
const KEY_USER = "linear_user_name";
const KEY_ORG = "linear_org_name";

interface LinearStore {
  projectId: string | null;
  apiKey: string | null;
  userName: string | null;
  orgName: string | null;
  issues: LinearIssue[];
  loading: boolean;
  error: string | null;

  loadForProject: (projectId: string) => Promise<void>;
  saveApiKey: (projectId: string, key: string) => Promise<boolean>;
  disconnect: (projectId: string) => Promise<void>;
  fetchIssues: () => Promise<void>;
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

  loadForProject: async (projectId: string) => {
    // Reset immediately to prevent stale data flash
    set({ projectId, apiKey: null, userName: null, orgName: null, issues: [], error: null });

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
    set({ apiKey: null, userName: null, orgName: null, issues: [], error: null });
  },

  fetchIssues: async () => {
    const { apiKey } = get();
    if (!apiKey) return;
    set({ loading: true, error: null });
    try {
      const issues = await linear.fetchMyIssues(apiKey);
      set({ issues, loading: false });
    } catch (e) {
      set({
        loading: false,
        error: e instanceof Error ? e.message : "Failed to fetch issues",
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
    });
  },

  clearError: () => set({ error: null }),
}));
