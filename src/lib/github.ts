import type { GitHubRepo } from "./types";

const GITHUB_API = "https://api.github.com";

async function githubFetch<T>(token: string, path: string): Promise<T> {
  const res = await fetch(`${GITHUB_API}${path}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
    },
  });

  if (!res.ok) {
    if (res.status === 401) throw new Error("Invalid token");
    throw new Error(`GitHub API error: ${res.status}`);
  }

  return res.json() as Promise<T>;
}

interface GitHubUser {
  login: string;
  name: string | null;
}

export async function verifyToken(
  token: string,
): Promise<{ valid: boolean; login: string; name: string; error?: string }> {
  try {
    const user = await githubFetch<GitHubUser>(token, "/user");
    return { valid: true, login: user.login, name: user.name ?? user.login };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return { valid: false, login: "", name: "", error: message };
  }
}

interface GitHubRepoRaw {
  id: number;
  full_name: string;
  name: string;
  owner: { login: string };
  description: string | null;
  default_branch: string;
  private: boolean;
  html_url: string;
}

function mapRepo(raw: GitHubRepoRaw): GitHubRepo {
  return {
    id: raw.id,
    full_name: raw.full_name,
    name: raw.name,
    owner: raw.owner.login,
    description: raw.description,
    default_branch: raw.default_branch,
    private: raw.private,
    html_url: raw.html_url,
  };
}

export async function searchRepos(
  token: string,
  query: string,
): Promise<GitHubRepo[]> {
  // Fetch user's repos (sorted by most recently pushed)
  const userRepos = await githubFetch<GitHubRepoRaw[]>(
    token,
    "/user/repos?per_page=100&sort=pushed&affiliation=owner,collaborator,organization_member",
  );

  let repos = userRepos.map(mapRepo);

  // If there's a query, also try GitHub search for broader results
  if (query.trim()) {
    const q = query.trim().toLowerCase();

    try {
      const user = await githubFetch<GitHubUser>(token, "/user");
      const searchResult = await githubFetch<{ items: GitHubRepoRaw[] }>(
        token,
        `/search/repositories?q=${encodeURIComponent(query)}+user:${user.login}&per_page=30`,
      );

      const searchRepos = searchResult.items.map(mapRepo);
      // Merge search results, avoiding duplicates
      const existingIds = new Set(repos.map((r) => r.id));
      for (const sr of searchRepos) {
        if (!existingIds.has(sr.id)) {
          repos.push(sr);
        }
      }
    } catch {
      // Search API failure is non-critical, fall through to client-side filter
    }

    // Client-side filter
    repos = repos.filter(
      (r) =>
        r.full_name.toLowerCase().includes(q) ||
        r.name.toLowerCase().includes(q) ||
        (r.description?.toLowerCase().includes(q) ?? false),
    );
  }

  return repos;
}
