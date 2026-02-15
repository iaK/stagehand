import { useEffect, useState, useRef } from "react";
import { useGitHubStore } from "../../stores/githubStore";
import { searchRepos } from "../../lib/github";
import type { GitHubRepo } from "../../lib/types";

interface GitHubRepoSearchProps {
  onSelect: (repo: GitHubRepo) => void;
  onClose: () => void;
}

export function GitHubRepoSearch({ onSelect, onClose }: GitHubRepoSearchProps) {
  const { token } = useGitHubStore();
  const [query, setQuery] = useState("");
  const [repos, setRepos] = useState<GitHubRepo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  const doSearch = async (q: string) => {
    if (!token) return;
    setLoading(true);
    setError(null);
    try {
      const results = await searchRepos(token, q);
      setRepos(results);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to search repos");
    } finally {
      setLoading(false);
    }
  };

  // Initial load
  useEffect(() => {
    doSearch("");
  }, [token]);

  // Debounced search
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      doSearch(query);
    }, 300);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query]);

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-zinc-900 border border-zinc-700 rounded-xl p-6 w-[560px] max-w-[90vw] max-h-[80vh] flex flex-col">
        <h2 className="text-lg font-semibold text-zinc-100 mb-4">
          Select GitHub Repository
        </h2>

        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="w-full bg-zinc-800 text-zinc-100 border border-zinc-700 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-500 mb-3"
          placeholder="Search repositories..."
          autoFocus
        />

        <div className="flex-1 overflow-y-auto min-h-0">
          {loading && (
            <div className="text-sm text-zinc-500 text-center py-8">
              Loading repositories...
            </div>
          )}
          {error && (
            <div className="text-sm text-red-400 text-center py-8">
              {error}
            </div>
          )}
          {!loading && !error && repos.length === 0 && (
            <div className="text-sm text-zinc-500 text-center py-8">
              No repositories found
            </div>
          )}
          {!loading &&
            repos.map((repo) => (
              <button
                key={repo.id}
                onClick={() => onSelect(repo)}
                className="w-full text-left px-3 py-2.5 rounded-lg hover:bg-zinc-800 transition-colors flex items-start gap-3"
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-0.5">
                    <span className="text-sm font-medium text-zinc-200">
                      {repo.full_name}
                    </span>
                    <span
                      className={`text-xs px-1.5 py-0.5 rounded ${
                        repo.private
                          ? "bg-amber-900/30 text-amber-400"
                          : "bg-zinc-800 text-zinc-400"
                      }`}
                    >
                      {repo.private ? "Private" : "Public"}
                    </span>
                  </div>
                  {repo.description && (
                    <div className="text-xs text-zinc-500 truncate">
                      {repo.description}
                    </div>
                  )}
                  <div className="text-xs text-zinc-600 mt-0.5">
                    Default branch: {repo.default_branch}
                  </div>
                </div>
              </button>
            ))}
        </div>

        <div className="flex justify-end mt-4 pt-3 border-t border-zinc-800">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-sm text-zinc-400 hover:text-zinc-200 transition-colors"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
