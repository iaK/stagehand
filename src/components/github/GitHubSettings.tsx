import { useEffect, useState } from "react";
import { useGitHubStore } from "../../stores/githubStore";
import { GitHubRepoSearch } from "./GitHubRepoSearch";
import * as repo from "../../lib/repositories";
import type { GitHubRepo } from "../../lib/types";

interface GitHubSettingsProps {
  projectId: string;
  onClose: () => void;
}

export function GitHubSettings({ projectId, onClose }: GitHubSettingsProps) {
  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-zinc-900 border border-zinc-700 rounded-xl p-6 w-[480px] max-w-[90vw]">
        <h2 className="text-lg font-semibold text-zinc-100 mb-4">
          GitHub Integration
        </h2>
        <GitHubSettingsContent projectId={projectId} />
        <div className="flex justify-end mt-4">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-sm text-zinc-400 hover:text-zinc-200 transition-colors"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

export function GitHubSettingsContent({ projectId }: { projectId: string }) {
  const { token, userName, loading, error, saveToken, disconnect, clearError } =
    useGitHubStore();
  const [tokenInput, setTokenInput] = useState("");
  const [showRepoSearch, setShowRepoSearch] = useState(false);
  const [linkedRepo, setLinkedRepo] = useState<string | null>(null);
  const [loadingRepo, setLoadingRepo] = useState(true);

  const connected = !!token && !!userName;

  // Load linked repo on mount
  useEffect(() => {
    (async () => {
      const fullName = await repo.getProjectSetting(projectId, "github_repo_full_name");
      setLinkedRepo(fullName);
      setLoadingRepo(false);
    })();
  }, [projectId]);

  const handleConnect = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!tokenInput.trim()) return;
    const ok = await saveToken(projectId, tokenInput.trim());
    if (ok) setTokenInput("");
  };

  const handleDisconnect = async () => {
    await disconnect(projectId);
  };

  const handleRepoSelect = async (selected: GitHubRepo) => {
    setShowRepoSearch(false);
    await repo.setProjectSetting(projectId, "github_repo_owner", selected.owner);
    await repo.setProjectSetting(projectId, "github_repo_name", selected.name);
    await repo.setProjectSetting(projectId, "github_default_branch", selected.default_branch);
    await repo.setProjectSetting(projectId, "github_repo_full_name", selected.full_name);
    setLinkedRepo(selected.full_name);
  };

  const handleUnlinkRepo = async () => {
    await repo.deleteProjectSetting(projectId, "github_repo_owner");
    await repo.deleteProjectSetting(projectId, "github_repo_name");
    await repo.deleteProjectSetting(projectId, "github_default_branch");
    await repo.deleteProjectSetting(projectId, "github_repo_full_name");
    setLinkedRepo(null);
  };

  return (
    <>
      {connected ? (
        <div>
          <div className="flex items-center gap-2 mb-4 p-3 bg-zinc-800 rounded-lg">
            <div className="w-2 h-2 rounded-full bg-green-500" />
            <span className="text-sm text-zinc-300">
              Connected as{" "}
              <span className="font-medium text-zinc-100">{userName}</span>
            </span>
          </div>

          {/* Linked Repository */}
          <div className="mb-4">
            <label className="block text-sm text-zinc-400 mb-1">
              Linked Repository
            </label>
            {loadingRepo ? (
              <div className="text-xs text-zinc-500">Loading...</div>
            ) : linkedRepo ? (
              <div className="flex items-center gap-2 p-2 bg-zinc-800 border border-zinc-700 rounded-lg">
                <svg className="w-4 h-4 text-zinc-400 flex-shrink-0" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0024 12c0-6.63-5.37-12-12-12z" />
                </svg>
                <span className="text-sm text-zinc-200 flex-1">{linkedRepo}</span>
                <button
                  type="button"
                  onClick={handleUnlinkRepo}
                  className="text-zinc-500 hover:text-zinc-300 transition-colors"
                  title="Unlink repository"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setShowRepoSearch(true)}
                className="w-full text-left px-3 py-2 bg-zinc-800 border border-zinc-700 border-dashed rounded-lg text-sm text-zinc-500 hover:text-zinc-300 hover:border-zinc-600 transition-colors"
              >
                Select Repository...
              </button>
            )}
          </div>

          <div className="flex justify-end">
            <button
              onClick={handleDisconnect}
              className="px-4 py-2 text-sm bg-red-600/20 text-red-400 hover:bg-red-600/30 rounded-lg transition-colors"
            >
              Disconnect
            </button>
          </div>
        </div>
      ) : (
        <form onSubmit={handleConnect}>
          <div className="mb-4">
            <label className="block text-sm text-zinc-400 mb-1">
              Personal Access Token
            </label>
            <input
              type="password"
              value={tokenInput}
              onChange={(e) => {
                setTokenInput(e.target.value);
                if (error) clearError();
              }}
              className="w-full bg-zinc-800 text-zinc-100 border border-zinc-700 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-500"
              placeholder="ghp_..."
              autoFocus
            />
            {error && (
              <p className="text-xs text-red-400 mt-1">{error}</p>
            )}
            <p className="text-xs text-zinc-500 mt-2">
              Generate a token at{" "}
              <span className="text-zinc-400">
                GitHub Settings &gt; Developer settings &gt; Personal access
                tokens
              </span>
            </p>
          </div>
          <div className="flex justify-end">
            <button
              type="submit"
              disabled={!tokenInput.trim() || loading}
              className="px-4 py-2 text-sm bg-blue-600 hover:bg-blue-500 disabled:bg-zinc-700 disabled:text-zinc-500 text-white rounded-lg transition-colors"
            >
              {loading ? "Verifying..." : "Connect"}
            </button>
          </div>
        </form>
      )}

      {showRepoSearch && (
        <GitHubRepoSearch
          onSelect={handleRepoSelect}
          onClose={() => setShowRepoSearch(false)}
        />
      )}
    </>
  );
}
