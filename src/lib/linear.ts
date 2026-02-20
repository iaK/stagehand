import type { LinearIssue } from "./types";
import { LINEAR_PAGE_SIZE } from "./constants";
import { withRetry } from "./retry";

const LINEAR_API = "https://api.linear.app/graphql";

export class HttpError extends Error {
  constructor(message: string, public status: number) {
    super(message);
  }
}

async function gql<T>(apiKey: string, query: string, variables?: Record<string, unknown>): Promise<T> {
  return withRetry(
    async () => {
      const res = await fetch(LINEAR_API, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: apiKey,
        },
        body: JSON.stringify(variables ? { query, variables } : { query }),
      });

      if (!res.ok) {
        if (res.status === 401) throw new Error("Invalid API key");
        throw new HttpError(`Linear API error: ${res.status}`, res.status);
      }

      const json = await res.json();
      if (json.errors?.length) {
        throw new Error(json.errors[0].message);
      }
      return json.data as T;
    },
    {
      shouldRetry: (error) => {
        if (error instanceof TypeError) return true; // network error
        if (error instanceof HttpError) {
          if (error.status === 401) return false;
          return error.status === 429 || error.status >= 500;
        }
        return false;
      },
    },
  );
}

interface ViewerResponse {
  viewer: {
    name: string;
    organization: { id: string; name: string };
  };
}

export async function verifyApiKey(
  apiKey: string,
): Promise<{ valid: boolean; name: string; orgName: string; error?: string }> {
  try {
    const data = await gql<ViewerResponse>(
      apiKey,
      `{ viewer { name organization { id name } } }`,
    );
    return { valid: true, name: data.viewer.name, orgName: data.viewer.organization.name };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return { valid: false, name: "", orgName: "", error: message };
  }
}

interface AssignedIssuesResponse {
  viewer: {
    assignedIssues: {
      nodes: Array<{
        id: string;
        identifier: string;
        title: string;
        description: string | null;
        priority: number;
        url: string;
        state: { name: string } | null;
        branchName: string | null;
      }>;
    };
  };
}

export async function fetchMyIssues(
  apiKey: string,
): Promise<LinearIssue[]> {
  const data = await gql<AssignedIssuesResponse>(
    apiKey,
    `{
      viewer {
        assignedIssues(
          filter: { state: { type: { nin: ["completed", "canceled"] } } }
          first: ${LINEAR_PAGE_SIZE}
        ) {
          nodes {
            id
            identifier
            title
            description
            priority
            url
            state { name }
            branchName
          }
        }
      }
    }`,
  );

  return data.viewer.assignedIssues.nodes.map((issue) => ({
    id: issue.id,
    identifier: issue.identifier,
    title: issue.title,
    description: issue.description ?? undefined,
    status: issue.state?.name ?? "Unknown",
    priority: issue.priority,
    url: issue.url,
    branchName: issue.branchName ?? undefined,
  }));
}

interface IssueDetailResponse {
  issue: {
    description: string | null;
    comments: {
      nodes: Array<{
        body: string;
        user: { name: string } | null;
        createdAt: string;
      }>;
    };
  };
}

export async function fetchIssueDetail(
  apiKey: string,
  issueId: string,
): Promise<{ description: string | undefined; comments: string[] }> {
  const data = await gql<IssueDetailResponse>(
    apiKey,
    `query ($id: String!) {
      issue(id: $id) {
        description
        comments(first: ${LINEAR_PAGE_SIZE}) {
          nodes {
            body
            user { name }
            createdAt
          }
        }
      }
    }`,
    { id: issueId },
  );

  const comments = data.issue.comments.nodes.map((c) => {
    const author = c.user?.name ?? "Unknown";
    return `${author}: ${c.body}`;
  });

  return {
    description: data.issue.description ?? undefined,
    comments,
  };
}
