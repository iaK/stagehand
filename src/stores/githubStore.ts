import { create } from "zustand";
import * as repo from "../lib/repositories";
import { gitRemoteUrl, parseGitRemote, gitDefaultBranch } from "../lib/git";

interface GitHubStore {
  projectId: string | null;
  remoteUrl: string | null;
  repoFullName: string | null;
  defaultBranch: string | null;
  loading: boolean;
  error: string | null;

  loadForProject: (projectId: string, projectPath: string) => Promise<void>;
  refresh: (projectId: string, projectPath: string) => Promise<void>;
  setDefaultBranch: (branch: string, projectId?: string) => Promise<void>;
}

async function detectGitRemote(projectId: string, projectPath: string) {
  const url = await gitRemoteUrl(projectPath);
  if (!url) return { remoteUrl: null, repoFullName: null, defaultBranch: null };

  const parsed = parseGitRemote(url);
  const branch = await gitDefaultBranch(projectPath);

  const repoFullName = parsed ? `${parsed.owner}/${parsed.repo}` : null;
  const defaultBranch = branch ?? "main";

  // Persist to project settings
  if (parsed) {
    await repo.setProjectSetting(projectId, "github_repo_owner", parsed.owner);
    await repo.setProjectSetting(projectId, "github_repo_name", parsed.repo);
    await repo.setProjectSetting(projectId, "github_repo_full_name", repoFullName!);
  }
  await repo.setProjectSetting(projectId, "github_default_branch", defaultBranch);

  return { remoteUrl: url, repoFullName, defaultBranch };
}

export const useGitHubStore = create<GitHubStore>((set, get) => ({
  projectId: null,
  remoteUrl: null,
  repoFullName: null,
  defaultBranch: null,
  loading: false,
  error: null,

  loadForProject: async (projectId: string, projectPath: string) => {
    const current = get();
    // If already loaded for this project, skip re-detection
    if (current.projectId === projectId && current.defaultBranch && !current.error) return;

    set({
      projectId,
      remoteUrl: null,
      repoFullName: null,
      defaultBranch: null,
      loading: true,
      error: null,
    });

    try {
      const result = await detectGitRemote(projectId, projectPath);
      if (get().projectId !== projectId) return;
      set({ ...result, loading: false });
    } catch (e) {
      if (get().projectId !== projectId) return;
      set({
        loading: false,
        error: e instanceof Error ? e.message : "Failed to detect git remote",
      });
    }
  },

  setDefaultBranch: async (branch: string, explicitProjectId?: string) => {
    const projectId = explicitProjectId ?? get().projectId;
    set({ defaultBranch: branch });
    if (projectId) {
      await repo.setProjectSetting(projectId, "github_default_branch", branch);
    }
  },

  refresh: async (projectId: string, projectPath: string) => {
    set({ loading: true, error: null });
    try {
      const result = await detectGitRemote(projectId, projectPath);
      if (get().projectId !== projectId) return;
      set({ ...result, loading: false });
    } catch (e) {
      if (get().projectId !== projectId) return;
      set({
        loading: false,
        error: e instanceof Error ? e.message : "Failed to detect git remote",
      });
    }
  },
}));
