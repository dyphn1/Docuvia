import { logger } from "../utils/logger.js";

const GITHUB_API_BASE = "https://api.github.com";

function buildHeaders(token?: string): Record<string, string> {
  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
  };
  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }
  return headers;
}

export interface GithubCommit {
  sha: string;
  commit: {
    message: string;
    author: { name: string; date: string };
  };
}

/**
 * Fetch all commits on a PR (handles pagination, max 250)
 */
export async function fetchPrCommits(
  owner: string,
  repo: string,
  prNumber: number,
  token?: string
): Promise<GithubCommit[]> {
  const headers = buildHeaders(token);
  const allCommits: GithubCommit[] = [];
  let page = 1;
  const maxPages = 3; // 3 pages × 100 = 300 max, but we'll cap at 250

  while (page <= maxPages && allCommits.length < 250) {
    const url = `${GITHUB_API_BASE}/repos/${owner}/${repo}/pulls/${prNumber}/commits?per_page=100&page=${page}`;
    const res = await fetch(url, { headers });
    if (!res.ok) {
      const err = await res.json().catch((e) => {
        logger.error({ err: e }, "Failed to parse JSON error response");
        return {};
      });
      const message = (err as { message?: string }).message ?? res.statusText;
      logger.warn(
        { owner, repo, prNumber, page, status: res.status },
        `GitHub API error: ${message}`
      );
      break;
    }
    const data = (await res.json()) as GithubCommit[];
    if (!data.length) break;
    allCommits.push(...data);
    if (data.length < 100) break;
    page++;
  }

  return allCommits.slice(0, 250);
}

/**
 * Fetch the unified diff of a PR (returns raw text)
 */
export async function fetchPrDiff(
  owner: string,
  repo: string,
  prNumber: number,
  token?: string
): Promise<string> {
  const headers = buildHeaders(token);
  headers["Accept"] = "application/vnd.github.v3.diff";
  const url = `${GITHUB_API_BASE}/repos/${owner}/${repo}/pulls/${prNumber}`;
  const res = await fetch(url, { headers });
  if (!res.ok) {
    logger.warn({ owner, repo, prNumber, status: res.status }, "Failed to fetch PR diff");
    return "";
  }
  return res.text();
}

/**
 * Post a comment on a PR issue thread
 */
export async function postPrComment(
  owner: string,
  repo: string,
  prNumber: number,
  body: string,
  token: string
): Promise<void> {
  const headers = buildHeaders(token);
  headers["Content-Type"] = "application/json";
  const url = `${GITHUB_API_BASE}/repos/${owner}/${repo}/issues/${prNumber}/comments`;
  const res = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify({ body }),
  });
  if (!res.ok) {
    const err = await res.json().catch((e) => {
      logger.error({ err: e }, "Failed to parse JSON error response");
      return {};
    });
    const message = (err as { message?: string }).message ?? res.statusText;
    logger.warn(
      { owner, repo, prNumber, status: res.status },
      `Failed to post PR comment: ${message}`
    );
  }
}

/**
 * Parse "owner/repo" from a GitHub URL
 */
export function parseGithubRepo(repoUrl: string): { owner: string; repo: string } | null {
  const match = repoUrl.match(/github\.com[:/]([^/]+)\/([^/.]+)/);
  if (!match) return null;
  const [, owner, repo] = match;
  if (!owner || !repo) return null;
  return { owner, repo };
}

/**
 * Check if a commit is an ancestor of the default branch
 */
export async function checkCommitInDefaultBranch(
  owner: string,
  repo: string,
  commitSha: string,
  token?: string,
  defaultBranch: string = "main"
): Promise<boolean> {
  const headers = buildHeaders(token);
  const url = `${GITHUB_API_BASE}/repos/${owner}/${repo}/compare/${defaultBranch}...${commitSha}`;
  const res = await fetch(url, { headers });
  if (!res.ok) {
    logger.warn(
      { owner, repo, commitSha, status: res.status },
      "Failed to fetch commit comparison"
    );
    return false;
  }
  const data = (await res.json()) as { status: string };
  // If the base (main) is ahead of the head (commitSha), status is "behind".
  // If they are the same, status is "identical".
  return data.status === "identical" || data.status === "behind";
}
