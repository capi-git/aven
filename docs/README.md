# Aven documentation

Start here if you are new to the codebase.

## First day

1. [Contributing](../.github/CONTRIBUTING.md): project layout, checks to run, and what a good pull request looks like.
2. [Develop Aven inside Aven](DEVELOPMENT.md): run a separate **Aven Dev** preview next to your installed app.
3. [Design rules](../DESIGN.md): how anything people see should look and read.
4. [Branding and compatibility](BRANDING.md): why a few internal names still say `monocode` or `supermono`, and why they must not be renamed with a find-and-replace.

## Building and shipping

- [Chromium build guide](CHROMIUM.md): the embedded browser on macOS.
- [Aven for Windows](WINDOWS.md): Windows builds and what is still macOS-only.
- [Releasing](RELEASING.md): version bumps, signing, notarization and the **Release Aven** workflow.
- [Performance](PERFORMANCE.md): the speed test and the costs it has measured. Read it before touching animation, scrolling or large lists.

## Features

- [Agent tools](AGENT-TOOLS.md): what agents running inside Aven can call.
- [Orchestration and Discuss](ORCHESTRATION.md) and [Race](RACE.md): running several agents together.
- [Connect your providers](PROVIDER-SETUP.md) and [GitHub accounts](GITHUB-ACCOUNTS.md).

## History

- [Reviewed upstream updates](UPSTREAM.md): which changes from the project Aven started from have been reviewed and ported.
- [Archive](archive/): dated audits, research notes and design explorations. They describe the code as it was on their date; check the current source before acting on them.
