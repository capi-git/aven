# Release

A release publishes what is on GitHub's `main` as a new version, built by the **Release Aven** workflow, where every installed Aven finds it within a day and offers Restart to update. It runs only when the person asked for a release in this run (`/aven release`, or `release` in the notes of a ship run). An earlier yes does not count, and a "make sure it works" is not a yes to publish.

Notes: the version number when it is not the next one, `trial` (a candidate run that publishes nothing), `no windows` (a Mac-only release; say what that costs Windows users), words for the changelog.

## 1. What goes out

Run `scripts/release-check`. It reads the account, `main` on GitHub and its version, the newest release, the installed Aven, release runs in progress, open pull requests, and the commits merged since the newest release. Say in one message, in the person's words, what the release will hold. Anything in it that has not run in Aven Dev or the real-app check, or that changes how chats, settings or projects are stored, is named first. An open pull request that the person meant to include is named too: it is merged first, only on their word. Then go on.

Nothing merged since the newest release means nothing to release: say so and stop.

## 2. Prove it

1. The pull requests in the release passed their checks (`ghp pr checks <n> --repo capi-git/aven`).
2. When the release holds a change of agent plumbing, provider adapters, teams, races or orchestration that never ran the real-app check, or a change that moves a control the check presses: a trial run first, from `main` (`ghp workflow run release.yml --repo capi-git/aven --ref main -f publish=false -f windows=true`), or the real-app check on this Mac behind the window gate. A trial takes about 25 minutes and publishes nothing.
3. Several pull requests that were never tested together: combine them in a `verify/batch` work tree first and run the checks there (`scripts/checks web tooling native`); after they merge, `git diff origin/main verify/batch -- . ':!CHANGELOG.md'` must be empty.

## 3. The release pull request

1. The version: the next number after the newest release, unless the notes name one.
2. A work tree on `release/<version>`, cut from `origin/main` after a fetch (`references/aven.md`, Where the work is).
3. `npm run set-version -- <version>` (it changes `package.json`, `package-lock.json`, `Cargo.toml` and `src-tauri/tauri.conf.json`), then `./scripts/with-dev-env.sh cargo metadata --format-version 1 > /dev/null` so that `Cargo.lock` follows. An earlier release commit changes exactly these six files with `CHANGELOG.md`; compare with `git show --stat` of the last "Release Aven" commit.
4. `CHANGELOG.md`: move what is under `## [Unreleased]` and write what the merged pull requests did under `## [<version>] - <date>`, in `### Added`, `### Changed`, `### Fixed`, each line a bold sentence a person would notice and one or two plain sentences after it, with no code and no file names. Read two earlier entries first and write the same way. `npx prettier --check CHANGELOG.md`.
5. `python3 -B scripts/test-bump-version.py`, `python3 -B scripts/test-release-workflow.py`, `python3 -B scripts/test-release-assets.py`.
6. `scripts/public-scan`, then commit the files by name as `Release Aven <version>`, with a body that lists what it holds (with the pull request numbers) and what was checked. Push the branch, run `scripts/public-scan --file` on the pull request body, open the pull request titled `Release Aven <version>`, and wait for its checks.

## 4. Merge and publish

Only on the person's word for this version (the request of this run).

1. No release run in progress (`scripts/release-check`); never merge to `main` while one runs.
2. Merge the feature pull requests that the release holds and are not yet merged, then the release pull request: `ghp pr merge <n> --repo capi-git/aven --squash --match-head-commit <the commit whose checks passed>`.
3. `scripts/release-check <version>`: the preflight (the account, `main`'s version and changelog entry, no tag of that name, no run in progress). It prints the one command that publishes. Run that command, then find the run (`ghp run list --repo capi-git/aven --workflow release.yml --limit 1`) and wait for it with one background command, `ghp run watch <id> --repo capi-git/aven --exit-status`. End the turn in a line that names it.
4. When it ends: `ghp release view v<version> --repo capi-git/aven --json tagName,isDraft,assets --jq '{tagName,isDraft,assets:[.assets[].name]}'`. The Mac zip, the `.app.tar.gz`, its `.sig`, `latest.json`, the stable `Aven-macos-arm64.zip`, the Windows files (unless `no windows`) and `SHA256SUMS` must be there, and `ghp release list --repo capi-git/aven --limit 1` must mark it Latest.

## 5. Tidy up and record

Remove the release work tree and its local branch; the `release/<version>` branch on GitHub is deleted by the merge. Add a line to `references/aven.md` only when the run learned a fact the next run needs.

## 6. Report

As `references/reporting.md` says: the link of the release, that Apple accepted the build (the release notes say so), what is in it for a person, what ran as proof and what did not, and that the person's own Aven downloads it in the background and offers Restart to update. Say that this run did not install it: only the person's restart does.

## When something goes wrong

- The release run fails: read why (`ghp run view <id> --repo capi-git/aven --log-failed`). A real-app-check step that failed on a timing blip or a runner with no Mac free is run again with a fresh run of the same command (a `rerun --failed` has once skipped the real-app check); a fault in the code is corrected by a new pull request first. The version does not change while nothing was published.
- A merge reached `main` during a run and the publish job was refused: start a fresh run from `main`'s new head.
- The release exists but is wrong: never delete it and never move its tag. The next version corrects it.
- A Windows job failed and the person wants the Mac release now: a run with `-f windows=false` is a Mac-only release; say that Windows users then see no update until the next release with Windows.
