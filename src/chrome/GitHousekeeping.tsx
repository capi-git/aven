import { ask } from "@tauri-apps/plugin-dialog";
import { useCallback, useEffect, useState } from "react";
import { ExternalLink, GitBranch, Loader, Trash2 } from "./icons";
import { openInAppUrl } from "../lib/inAppLinks";
import { subscribeGitChanged } from "../lib/fs";
import {
  gitDeleteMergedBranches,
  gitMergedBranches,
  gitReleaseStart,
  gitReleaseStatus,
  summarizeRelease,
  type MergedBranches,
  type ReleaseStatus,
} from "../lib/gitHousekeeping";
import "./GitHousekeeping.css";

/** A running release is worth watching; otherwise refresh on focus and Git changes. */
const RELEASE_RUNNING_POLL_MS = 30_000;
const BRANCHES_SHOWN = 6;

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Release status and merged-branch clean-up for the open project. */
export function GitHousekeeping({
  cwd,
  enabled,
}: {
  cwd: string;
  enabled: boolean;
}) {
  if (!enabled || !cwd || cwd === "~") return null;
  return (
    <>
      <ReleaseCard key={`release:${cwd}`} cwd={cwd} />
      <MergedBranchesCard key={`branches:${cwd}`} cwd={cwd} />
    </>
  );
}

function useRefresh(load: () => void, deps: unknown[]) {
  useEffect(() => {
    load();
    const onResume = () => {
      if (!document.hidden) load();
    };
    const stop = subscribeGitChanged(load);
    window.addEventListener("focus", onResume);
    document.addEventListener("visibilitychange", onResume);
    return () => {
      stop();
      window.removeEventListener("focus", onResume);
      document.removeEventListener("visibilitychange", onResume);
    };
    // The caller's deps decide when a new project needs a fresh read.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}

export function ReleaseCard({ cwd }: { cwd: string }) {
  const [status, setStatus] = useState<ReleaseStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(() => {
    void gitReleaseStatus(cwd)
      .then(setStatus)
      .catch(() => setStatus(null));
  }, [cwd]);
  useRefresh(load, [load]);
  const running = Boolean(status?.run && status.run.status !== "completed");
  useEffect(() => {
    if (!running) return;
    const timer = window.setInterval(load, RELEASE_RUNNING_POLL_MS);
    return () => window.clearInterval(timer);
  }, [running, load]);

  if (!status || (!status.workflow && !status.latest)) return null;
  const summary = summarizeRelease(status);
  const publish = async () => {
    const version = summary.publish;
    const sourceSha = status.sourceSha;
    if (!version || !sourceSha || busy) return;
    const ok = await ask(
      `Publish version ${version}? GitHub builds what's on ${status.base} and releases it to everyone who uses this project's downloads and updates.`,
      { title: "Aven", kind: "warning", okLabel: "Publish" },
    );
    if (!ok) return;
    setBusy(true);
    setError(null);
    try {
      await gitReleaseStart(cwd, version, sourceSha);
      // GitHub takes a moment to list a new run.
      window.setTimeout(load, 4_000);
    } catch (reason) {
      setError(message(reason));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="git-house" aria-label="Release">
      <h3 className="git-house-title">
        Release
        {status.latest ? <span>{status.latest.tag}</span> : null}
      </h3>
      <div className="git-house-card" data-tone={summary.tone} role="status">
        <p className="git-house-headline">
          {summary.tone === "busy" ? (
            <Loader
              className="size-3.5 shrink-0 animate-spin"
              strokeWidth={1.75}
            />
          ) : (
            <span className="git-house-dot" aria-hidden />
          )}
          <span>{summary.title}</span>
        </p>
        {summary.detail ? (
          <p className="git-house-detail">{summary.detail}</p>
        ) : null}
        {error ? (
          <p className="git-house-error" role="alert">
            {error}
          </p>
        ) : null}
        <div className="git-house-actions">
          {summary.publish ? (
            <button
              type="button"
              className="git-house-primary"
              disabled={busy}
              onClick={() => void publish()}
            >
              {busy ? (
                <Loader className="size-3.5 animate-spin" strokeWidth={1.75} />
              ) : null}
              Publish {summary.publish}
            </button>
          ) : null}
          {status.run && (running || summary.tone === "warn") ? (
            <button
              type="button"
              className="git-house-link"
              onClick={() => void openInAppUrl(status.run!.url)}
            >
              <ExternalLink className="size-3" strokeWidth={1.75} />
              View run
            </button>
          ) : null}
          {status.latest ? (
            <button
              type="button"
              className="git-house-link"
              onClick={() => void openInAppUrl(status.latest!.url)}
            >
              <ExternalLink className="size-3" strokeWidth={1.75} />
              View release
            </button>
          ) : null}
        </div>
      </div>
    </section>
  );
}

export function MergedBranchesCard({ cwd }: { cwd: string }) {
  const [branches, setBranches] = useState<MergedBranches | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const load = useCallback(() => {
    void gitMergedBranches(cwd)
      .then(setBranches)
      .catch(() => setBranches(null));
  }, [cwd]);
  useRefresh(load, [load]);

  const local = branches?.local ?? [];
  const remote = branches?.remoteBranches ?? [];
  const total = local.length + remote.length;
  if (!branches || (total === 0 && !note)) return null;
  const remoteName = branches.remote ?? "remote";
  const names = [
    ...local.map((name) => ({ name, where: "Local" })),
    ...remote.map((name) => ({
      name,
      where: remoteName === "origin" ? "GitHub" : remoteName,
    })),
  ];

  const clean = async () => {
    if (busy || total === 0) return;
    const parts = [
      local.length ? `${local.length} local` : "",
      remote.length
        ? `${remote.length} on ${remoteName === "origin" ? "GitHub" : remoteName}`
        : "",
    ].filter(Boolean);
    const ok = await ask(
      `Delete ${total} merged ${total === 1 ? "branch" : "branches"} (${parts.join(", ")})? Their work is already in ${branches.base}. Branches that are open in a copy are kept.`,
      { title: "Aven", kind: "warning", okLabel: "Delete" },
    );
    if (!ok) return;
    setBusy(true);
    try {
      const result = await gitDeleteMergedBranches(cwd, local, remote);
      const deleted = result.deletedLocal.length + result.deletedRemote.length;
      setNote(
        result.failed.length
          ? `Deleted ${deleted}. Couldn't delete ${result.failed.join(", ")}.`
          : `Deleted ${deleted} merged ${deleted === 1 ? "branch" : "branches"}.`,
      );
    } catch (reason) {
      setNote(message(reason));
    } finally {
      setBusy(false);
      load();
    }
  };

  return (
    <section className="git-house" aria-label="Merged branches">
      <h3 className="git-house-title">
        Merged branches
        {total ? <span>{total} to clean up</span> : null}
      </h3>
      <div className="git-house-card" data-tone="neutral">
        {total ? (
          <ul className="git-house-branches">
            {names.slice(0, BRANCHES_SHOWN).map(({ name, where }) => (
              <li key={`${where}:${name}`}>
                <GitBranch className="size-3 shrink-0" strokeWidth={1.75} />
                <span className="git-house-branch">{name}</span>
                <span className="git-house-where">{where}</span>
              </li>
            ))}
            {names.length > BRANCHES_SHOWN ? (
              <li className="git-house-more">
                {names.length - BRANCHES_SHOWN} more
              </li>
            ) : null}
          </ul>
        ) : null}
        {note ? <p className="git-house-detail">{note}</p> : null}
        {total ? (
          <div className="git-house-actions">
            <button
              type="button"
              className="git-house-secondary"
              disabled={busy}
              onClick={() => void clean()}
            >
              {busy ? (
                <Loader className="size-3.5 animate-spin" strokeWidth={1.75} />
              ) : (
                <Trash2 className="size-3.5" strokeWidth={1.75} />
              )}
              Delete merged branches
            </button>
          </div>
        ) : null}
      </div>
    </section>
  );
}
