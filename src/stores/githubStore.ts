import { create } from "zustand";
import * as repo from "../lib/repositories";
import * as github from "../lib/github";

const KEY_TOKEN = "github_token";
const KEY_LOGIN = "github_login";
const KEY_USER_NAME = "github_user_name";

interface GitHubStore {
  projectId: string | null;
  token: string | null;
  login: string | null;
  userName: string | null;
  loading: boolean;
  error: string | null;

  loadForProject: (projectId: string) => Promise<void>;
  saveToken: (projectId: string, token: string) => Promise<boolean>;
  disconnect: (projectId: string) => Promise<void>;
  clearError: () => void;
}

export const useGitHubStore = create<GitHubStore>((set, get) => ({
  projectId: null,
  token: null,
  login: null,
  userName: null,
  loading: false,
  error: null,

  loadForProject: async (projectId: string) => {
    // Reset immediately to prevent stale data flash
    set({ projectId, token: null, login: null, userName: null, error: null });

    const token = await repo.getProjectSetting(projectId, KEY_TOKEN);
    if (!token) return;

    // Guard against project switch during async work
    if (get().projectId !== projectId) return;

    set({ token });

    const result = await github.verifyToken(token);
    if (get().projectId !== projectId) return;

    if (result.valid) {
      set({ login: result.login, userName: result.name });
      await repo.setProjectSetting(projectId, KEY_LOGIN, result.login);
      await repo.setProjectSetting(projectId, KEY_USER_NAME, result.name);
    } else {
      // Token is stored but invalid — clear it
      await repo.deleteProjectSetting(projectId, KEY_TOKEN);
      await repo.deleteProjectSetting(projectId, KEY_LOGIN);
      await repo.deleteProjectSetting(projectId, KEY_USER_NAME);
      set({ token: null, login: null, userName: null });
    }
  },

  saveToken: async (projectId: string, token: string) => {
    set({ loading: true, error: null });
    try {
      const result = await github.verifyToken(token);
      if (!result.valid) {
        set({ loading: false, error: result.error ?? "Invalid token" });
        return false;
      }
      await repo.setProjectSetting(projectId, KEY_TOKEN, token);
      await repo.setProjectSetting(projectId, KEY_LOGIN, result.login);
      await repo.setProjectSetting(projectId, KEY_USER_NAME, result.name);
      set({
        token,
        login: result.login,
        userName: result.name,
        loading: false,
      });
      return true;
    } catch (e) {
      set({
        loading: false,
        error: e instanceof Error ? e.message : "Failed to save token",
      });
      return false;
    }
  },

  disconnect: async (projectId: string) => {
    await repo.deleteProjectSetting(projectId, KEY_TOKEN);
    await repo.deleteProjectSetting(projectId, KEY_LOGIN);
    await repo.deleteProjectSetting(projectId, KEY_USER_NAME);
    set({ token: null, login: null, userName: null, error: null });
  },

  clearError: () => set({ error: null }),
}));
