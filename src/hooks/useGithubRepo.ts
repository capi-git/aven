import { useEffect, useState } from "react";
import { isTauri } from "@tauri-apps/api/core";
import { githubRepo } from "../lib/githubTasks";
import { projectKey } from "../lib/paths";

/** Each project's GitHub repository, or null when it has none, once asked. */
const known = new Map<string, string | null>();
const asking = new Map<string, Promise<string | null>>();

function ask(project: string): Promise<string | null> {
  const key = projectKey(project);
  let pending = asking.get(key);
  if (!pending) {
    pending = githubRepo(project).then(
      (repo) => repo || null,
      // Not on GitHub, or GitHub's command line isn't set up: no repository.
      () => null,
    );
    asking.set(key, pending);
    void pending.then((repo) => {
      known.set(key, repo);
      asking.delete(key);
    });
  }
  return pending;
}

/**
 * The project's GitHub repository ("owner/name"), or null when it has none
 * or until it is known. Asked once per project while `enabled`, never again
 * this session.
 */
export function useGithubRepo(project: string, enabled = true): string | null {
  const key = projectKey(project);
  const [repo, setRepo] = useState(() => known.get(key) ?? null);
  useEffect(() => {
    if (!enabled || !isTauri()) return;
    if (known.has(key)) {
      setRepo(known.get(key) ?? null);
      return;
    }
    let current = true;
    void ask(project).then((found) => {
      if (current) setRepo(found);
    });
    return () => {
      current = false;
    };
  }, [enabled, key, project]);
  return repo;
}

/** Forget what was asked (tests). */
export function resetGithubRepos(): void {
  known.clear();
  asking.clear();
}
