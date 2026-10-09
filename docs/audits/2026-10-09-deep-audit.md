# Pre-release audit — October 9, 2026

Reviewed the combined 0.1.128 changes at `610f7aa8` in an isolated checkout,
including the interrupted Claude audit and the subsequent storage, provider,
Git, terminal and view hardening. Other worktrees and the installed Aven host
were left intact. The initial follow-up updated dependency pins and their matching notice.
Subsequent Windows release validation exposed the backup-handle issue described
below; that fix and earlier Windows CI coverage are also included.

## Findings and fixes

- Updated `source-map-js` from 1.2.1 to 1.2.2, resolving its high-severity
  [indexed-source-map denial-of-service advisory](https://github.com/advisories/GHSA-68fv-2mgg-jv7q) in the development toolchain.
- Updated DOMPurify from 3.4.13 to 3.4.16, resolving the reported sanitizer
  advisories without changing Mermaid's strict security configuration.
- `npm audit` now reports four low-severity findings, all in the KaTeX
  dependency chain. The [KaTeX advisory](https://github.com/advisories/GHSA-238p-pmpm-9mq7) requires prior prototype pollution and unsafe
  insertion without separate sanitization. This is a remaining dependency
  finding, not a claim that the app has zero security advisories. Forcing a
  cross-major KaTeX override across Mermaid and Streamdown was not included.
- Initial local source checks found no new blocker; Windows release validation
  subsequently exposed the backup failure below. Reviewed cache bounds,
  lazy imports, poller visibility guards, native listener cleanup, transcript
  migration/delta saves, provider setup and model fallback, literal Git paths,
  terminal startup/close ordering, and retryable view loading against their
  regression tests. Existing lint warnings remain; passing lint is not a claim
  of zero warnings.

## Automated verification

- `npm run check:web`: 4,307 tests across 388 files, TypeScript including tests,
  Prettier and lint passed, including a second complete run after dependency
  updates.
- `npm run check:tooling`: packaging, signing, release/workflow/assets,
  development launcher, update and version tooling tests passed, including
  14 browser sleep/update probe tests.
- Rust formatting and locked Clippy with warnings denied passed. All 592 Rust
  tests passed both with Chromium enabled and with `--no-default-features`.
- Built all 12 Chromium CMake test executables and passed all 12 CTest cases.
- Production frontend build passed. The static startup graph was 3,089,573
  minified bytes / 996,304 independently gzipped bytes, measured with
  `scripts/measure-boot-bundle.mjs`. This retains the prior lazy-loading gains;
  it is not a startup-latency measurement. The actual Mermaid engine remains a
  dynamic import despite a shared chunk's Mermaid-derived filename.
- `npm run dev:doctor` and a complete Aven Dev package passed. Strict signature
  verification passed for the 269-file bundle with 10 native payloads, with
  Chromium sandboxing enabled and no library-validation exception.

## Native interaction checks

Ran the separately identified Aven Dev app using its own existing development
state. The installed production app stayed running.

Observed working sidebar show/hide and width drags in both directions;
Appearance, Providers & models, Skills & tools and Browser settings; Notes and
Inbox view navigation; chat-tab switching; model catalog arrival; and return to
the chat. The sidebar width was restored after testing. No account settings,
production chats or filesystem documents were changed for these checks.

A real Codex turn completed and displayed `AUDIT-CODEX-OK`, syntax-highlighted
TypeScript and a rendered Mermaid A-to-B diagram. The independently attempted
Claude turn reached its account session limit (reset shown as 1:20 PM Pacific).
Aven displayed the quota error and returned control to the composer. A successful
Claude response is therefore **not** verified by this live run; provider tests
passed separately.

Window-only screenshot capture intermittently rejected dimensions. Scoped
region captures succeeded and were inspected; no external automation route was
substituted. Native desktop glass was preserved.

## Resource and motion measurements

Environment: Mac17,7, 18 logical CPUs, 36 GiB RAM, macOS 27.0 (26A428). Development
window 1,825 × 956 points, existing 80% interface scale, dark transparent theme.
No build or test suite ran during the measured phases. Other user applications
remained open, so this is an observed workload rather than an isolated benchmark.

One-second samples aggregate the Aven Dev process and helpers attributed to it
by macOS process responsibility, including WebKit. CPU uses `proc_pid_rusage`
user + system time converted with the machine's Mach timebase, cross-checked
against `ps`; 100% means one fully busy core. Memory is summed physical footprint,
not the main process alone and not unique heap size. GPU values below are raw
per-process driver `accumulatedGPUTime` deltas; they are **not** hardware
utilization percentages and exclude unattributed WindowServer compositing.

| Phase                                               | Duration | Mean CPU | Peak 1-second CPU | Final footprint | GPU counter delta |
| --------------------------------------------------- | -------: | -------: | ----------------: | --------------: | ----------------: |
| Visible, no interaction                             |     45 s |    3.36% |             9.35% |         523 MiB |       203,217,958 |
| Hidden with Cmd-H                                   |     45 s |    1.86% |             8.17% |         528 MiB |       111,185,750 |
| Codex reply, first code/diagram load and tab change |     60 s |    9.04% |            96.26% |         780 MiB |       540,071,083 |

The active phase peaked at 941 MiB as additional modules and provider processes
loaded. The initial visible sample reclaimed memory from 685 to 523 MiB. A final
45-second post-navigation sample declined from 795 to 766 MiB while the last
motion probe ran. These short observations do not establish a long-duration leak bound or a production
memory target.

An opt-in temporary development probe collected requestAnimationFrame timing
and input-to-two-animation-frame delay, then was removed before release. It did
not run a frame loop during the idle samples. Three one-minute captures produced:

| Workload                                               | Frames | 95th / 99th percentile interval | Frames over 33.4 ms | Worst interval |
| ------------------------------------------------------ | -----: | ------------------------------: | ------------------: | -------------: |
| Sidebar and settings navigation                        |  7,188 |                      10 / 10 ms |                   2 |          43 ms |
| Claude quota handling, tab switching and sidebar drags |  7,185 |                       9 / 10 ms |                   2 |          58 ms |
| Inbox, Notes and return to chat                        |  7,178 |                      10 / 10 ms |                   5 |          71 ms |

The cadence is approximately 120 animation callbacks per second. Sampled
input-to-two-frame delays were 8–64 ms. No uncaught errors or unhandled promise
rejections were recorded in these captures. This measures animation scheduling,
not physical display presentation or INP; WebKit did not expose Long Tasks to
the probe. It is not a guarantee that every animation is jank-free.

## Remaining verification boundaries

These checks do not replace a prolonged multi-workspace soak, thermal/power
profiling, a clean-machine test, successful Claude output after quota reset,
Windows physical interaction, or an actual older-to-newer installation.
Windows build/test/installer validation belongs to the release workflow. Final
release checks must independently verify the published source, artifacts,
checksums, updater signatures, and macOS signing/notarization. Publication does
not install or restart the host app.

## Windows release gate follow-up

The first 0.1.128 release attempt at `6fc6e676` was stopped before publication
when Windows reported five failing native tests (451 passed). Three failures
came from one real runtime defect: the pre-migration snapshot was reopened
read-only before `sync_all`. Windows' `FlushFileBuffers` requires a handle with
[write access](https://learn.microsoft.com/en-us/windows/win32/api/fileapi/nf-fileapi-flushfilebuffers).
The backup now reopens the existing file with write access, without creation or
truncation, flushes it and then renames it. The transactional migration and
fail-open history error remain in place. Existing WAL snapshot, migration retry
and stale-backup regression tests cover this path.

The other two failures were Unix assumptions in tests: removing a directory
junction with `remove_file`, and expecting a backslash to remain in a normalized
Windows path. The lock fixture now removes only its junction and explicitly
checks that the shared directory survives. The Git test checks C-style decoding
separately from platform-specific separator normalization. Neither change skips
the Windows assertion or changes the corresponding production behavior.

A dedicated Windows native job now runs formatting, Clippy and the full
native test suite on pull requests, so these differences are checked before a
release build. Windows Clippy reports existing unused-code warnings for Mac-specific helpers;
its new check does not deny those warnings. Compiler errors and failing tests
still block the job. macOS checks retain their existing name and strict warning
policy. Final
Windows validation is recorded by that job and the subsequent release workflow;
the cancelled build is not a published release.
