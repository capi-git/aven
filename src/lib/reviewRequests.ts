import {
  githubRepo,
  groupProjectsByRepo,
  listGithubWorkItems,
  uniqueInboxProjects,
} from "./githubTasks";

/**
 * Open pull requests that ask for the user's review, in the workspace's
 * GitHub repositories, through the same GitHub CLI calls as the Inbox. Asked
 * at most once per ten minutes for the same projects and never polled; any
 * failure (not signed in, no network, not a GitHub repository) reads as none.
 */
export type ReviewRequest = {
  repo: string;
  number: number;
  title: string;
  url: string;
  updatedAt: string;
};

export const REVIEW_REQUESTS_CACHE_MS = 10 * 60_000;
/** Bounds the CLI calls for a workspace with many repositories. */
const MAX_REPOS = 8;
const QUERY = "review-requested:@me";

let cache: { key: string; at: number; items: ReviewRequest[] } | null = null;
let inflight: { key: string; promise: Promise<ReviewRequest[]> } | null = null;

function cacheKey(paths: readonly string[]): string {
  return [...paths].sort().join("\n");
}

/** Cached requests for these projects while still fresh. */
export function peekReviewRequests(
  paths: readonly string[],
  now = Date.now(),
): ReviewRequest[] | null {
  const key = cacheKey(paths);
  return cache?.key === key && now - cache.at < REVIEW_REQUESTS_CACHE_MS
    ? cache.items
    : null;
}

async function fetchReviewRequests(
  paths: readonly string[],
): Promise<ReviewRequest[]> {
  const projects = uniqueInboxProjects(paths.map((path) => ({ path })));
  const resolved = await Promise.all(
    projects.map(async (project) => {
      try {
        return {
          path: project.path,
          repo: (await githubRepo(project.path)).trim(),
        };
      } catch {
        return { path: project.path, repo: "" };
      }
    }),
  );
  const repos = groupProjectsByRepo(resolved)
    .filter((project) => project.repo)
    .slice(0, MAX_REPOS);
  const lists = await Promise.all(
    repos.map((project) =>
      listGithubWorkItems(project.path, {
        kind: "pr",
        assignedToMe: false,
        state: "open",
        search: QUERY,
      }).then(
        (items) =>
          items.map((item) => ({
            repo: item.repo || project.repo,
            number: item.number,
            title: item.title,
            url: item.url,
            updatedAt: item.updatedAt,
          })),
        () => [] as ReviewRequest[],
      ),
    ),
  );
  const seen = new Set<string>();
  return lists
    .flat()
    .filter((item) => {
      if (!item.url || seen.has(item.url)) return false;
      seen.add(item.url);
      return true;
    })
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export function loadReviewRequests(
  paths: readonly string[],
  now = Date.now(),
): Promise<ReviewRequest[]> {
  const cached = peekReviewRequests(paths, now);
  if (cached) return Promise.resolve(cached);
  const key = cacheKey(paths);
  if (inflight?.key === key) return inflight.promise;
  const promise = fetchReviewRequests(paths)
    .catch(() => [] as ReviewRequest[])
    .then((items) => {
      cache = { key, at: Date.now(), items };
      return items;
    })
    .finally(() => {
      if (inflight?.promise === promise) inflight = null;
    });
  inflight = { key, promise };
  return promise;
}

/** For tests. */
export function clearReviewRequestsCache() {
  cache = null;
  inflight = null;
}
