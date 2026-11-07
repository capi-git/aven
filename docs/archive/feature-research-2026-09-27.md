# Feature ideas for Aven

Research date: September 27, 2026. Product research and source inspection only; no application changes or competitor installations. Rankings and effort are judgments, not measured estimates. Feature presence below is source-confirmed, not a packaged-app test.

## Recommended direction

Make completed agent work easier to assess, then make new agents easier to connect. Aven already has much of the foundation competitors advertise. The useful work is extending those foundations into complete workflows.

| Priority | Addition | Inspiration | First useful version | Relative effort |
| --- | --- | --- | --- | --- |
| 1 | Review with evidence | Cursor artifacts; Conductor review workflow | A session review surface combining changed files, recorded checks, preview captures, and unresolved findings | Medium–large |
| 2 | Configurable agent catalog | Zed ACP registry | Connect one additional ACP agent with capability discovery, then expose a curated catalog | Large |
| 3 | Durable feature specs | Kiro Specs | Save an editable feature brief and acceptance criteria; connect tasks and results to it across chats | Medium |
| 4 | Managed project run recipes | Conductor scripts | Extend saved commands with preview URL, process ownership, readiness, and workspace port allocation | Medium |
| 5 | Respond directly from Activity | cmux Feed/notifications | Expand an outstanding question or approval in Activity and answer it there | Small–medium |
| 6 | Recurring local tasks | Superset automations | Run a saved review/report task on a schedule, recording missed and completed runs | Large; later |

## 1. Review with evidence

[Cursor Cloud Agents](https://cursor.com/cloud) present videos, screenshots, and logs for validating work. [Conductor's workflow](https://www.conductor.build/docs/concepts/workflow) connects branch review, checks, PRs, and merge preparation.

Aven already has session diffs, Keep/Undo, and a second-opinion action. `src/chrome/SessionReview.tsx` and `src/lib/checkpoint.ts` expose changed files; `src/lib/secondOpinion.ts` sends a reviewer the request, report, and edited paths. The existing second-opinion prompt explicitly permits fixes, so it should not be relabeled as an independent read-only assessment.

Proposed experience: open Review and see “Files · Checks · Preview · Findings.” Every check shows its command, checkout, time, exit status, and the revision or working-tree fingerprint it tested. A screenshot carries its URL and capture time. Later edits mark evidence stale. Missing evidence says “Not verified.” An optional review-only mode records findings before any fix is requested.

Start with command receipts and screenshots; video can follow. This is especially useful when comparing two agent results: the same acceptance criteria and check commands make the comparison meaningful. Do not automatically choose or merge a winner.

Acceptance: a passing check becomes stale after relevant edits; failed or missing checks never become a generic green completion badge; evidence reopens after app restart. Automated checks, rendered previews, and packaged-app checks remain distinguishable.

## 2. Configurable agent catalog

[Zed External Agents](https://zed.dev/docs/ai/external-agents) supports installing agents from an ACP registry. The [upstream registry](https://github.com/agentclientprotocol/registry) currently includes Gemini, Copilot, Kimi, Mistral Vibe, Factory Droid, Amp, and others. Registry presence is not proof of compatibility with Aven.

Aven already has ACP infrastructure (`src/lib/harness/acp.ts`, `cursor.ts`, and `fxProtocol.ts`). Its provider identity list remains a fixed union in `src/lib/session.ts`, and the harness contract in `src/lib/harness/registry.ts` includes more than basic chat. The opportunity is configurable providers, not introducing ACP from scratch.

Start with Gemini CLI as a compatibility pilot; then evaluate Kimi and Mistral Vibe for broader provider choice, followed by Factory Droid and Amp. This ordering reflects variety and integration learning, not a model-quality benchmark.

The catalog should show installed version, login state, and supported features: images, resume, steering, approvals, and context reporting. Leave unsupported controls unavailable with a clear reason. Provider accounts and billing stay with the provider.

Acceptance: the pilot handles stream/cancel/restart/resume, permission requests, login failures, and malformed protocol output without affecting existing providers. A generic terminal launch alone does not count as a full integration.

## 3. Durable feature specs

[Kiro Specs](https://kiro.dev/docs/specs/) links requirements, design, and executable tasks. Its [Quick Spec](https://kiro.dev/docs/specs/quick-spec/) asks clarifying questions upfront and generates those artifacts without approval gates between phases.

Aven has plan blocks, editable approved plans, task lists, Notes, and provider handoffs. See `src/lib/session.ts`, `src/chrome/PlanPreview.tsx`, and `src/lib/handoff.ts`. A task-linked, durable requirements artifact would build on them.

First version: “Save as feature brief” from a plan, producing a normal Markdown file with scope, acceptance criteria, and unresolved questions. Link sessions and check results to individual criteria. Keep small tasks conversational; use a brief when the work spans sessions or agents.

Acceptance: switching provider or reopening the project retains the same brief; changing scope flags affected criteria for review; an agent marking a task complete does not itself prove its acceptance criteria passed.

## 4. Managed project run recipes

[Conductor scripts](https://www.conductor.build/docs/reference/scripts) provides named run commands, workspace setup, and per-workspace ports.

Aven already saves named run commands per working directory in `src/lib/workspaceActions.ts`, wired through `src/App.tsx`. Therefore a new Run button would duplicate existing functionality.

Extend those commands with a preview URL, readiness check, and owned process lifecycle. Starting a recipe should open its verified URL in Aven's browser; stopping it should stop only its process group. A portable project definition could make commands available in new workspaces while keeping local overrides.

Acceptance: two copies of a project can run without port collision; a readiness failure shows logs instead of opening a dead page; stopping a recipe leaves unrelated servers alive. Opening a repository must not silently execute setup scripts.

## 5. Respond from Activity

[cmux notifications](https://github.com/manaflow-ai/cmux/blob/main/docs/notifications.md) supports attention navigation and references Feed for inline permission, plan, and question responses.

Aven already has Needs you, finished history, unread state, and notification preferences in `src/chrome/ActivityPanel.tsx` and `src/lib/notifications.ts`. Current Activity rows navigate to the session. The incremental opportunity is answering the pending request directly in the panel and adding a shortcut to the next unresolved item.

Acceptance: resolving a request in its chat disables the stale Activity action; an approval identifies its exact project, provider, and requested action; duplicate events do not create duplicate decisions. Keep the existing session-specific permission scope.

## 6. Recurring local tasks

[Superset's SDK recipes](https://docs.superset.sh/sdk/advanced) demonstrate scheduled backlog processing and event-driven agent dispatch. The documentation labels its SDK early alpha, so this is workflow inspiration rather than a dependency recommendation.

Example for Aven: “Every Friday, summarize this week's local changes” or “Run the saved dependency review each Monday.” Start with reports and review output delivered to Activity. Aven's queue and orchestration are useful foundations; a durable scheduler was not identified in this focused source pass.

Define sleep/wake behavior, missed runs, overlap prevention, cancellation, and per-run limits before implementation. A local-only scheduler cannot promise execution while the Mac is asleep. Remote scheduling, automatic PR publication, and issue-triggered writes would be separate scope.

## X discovery and smaller tools

Watch [cmux / @manaflowai](https://x.com/manaflowai), [Conductor / @conductor_build](https://x.com/conductor_build), [Superset / @superset_sh](https://x.com/superset_sh), and [T3 Code](https://github.com/pingdotgg/t3code). These are a watchlist, not a ranking by popularity or claims that they all launched recently.

An indexed [March 7, 2026 X post](https://x.com/ZainMerchant9/status/2030428025565683986) describes a user's cmux, Pi, and mobile-access workflow. It is useful demand evidence for continuity across surfaces, but not an official feature announcement. Search results for several official accounts came through third-party mirrors; those were not used to substantiate product capabilities.

The cmux homepage was successfully opened and inspected in Aven's supplied browser. Opening X succeeded, but its snapshot returned `Browser returned an invalid action result`; a live X feed was not verified. Official docs and repositories support the shortlist. No authenticated actions were taken.

## Suggested sequence

Begin with a focused review panel prototype using one completed task and its actual test/preview evidence. In a separate technical spike, validate one additional ACP agent against Aven's harness contract. Choose between deeper review work and the provider catalog after seeing those two results. Inline Activity responses are a smaller independent improvement.

Defer remote fleets and mobile control until a clear need justifies their larger runtime and account-management scope. Checkpoints, basic provider switching, browser element comments, notifications, saved run commands, and a second-opinion action are already present in this source checkout and should not be presented as new features.
