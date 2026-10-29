<p align="center">
  <img src=".github/assets/banner.png" alt="Aven — every agent, one window. A desktop workspace for coding agents." width="720" />
</p>

<p align="center">
  <a href="https://github.com/capi-git/aven/releases/latest/download/Aven-macos-arm64.zip"><img src="https://img.shields.io/badge/Download_for_Mac-Apple_Silicon-111?style=for-the-badge&logo=apple&logoColor=white" alt="Download for Mac" /></a>
  <a href="https://github.com/capi-git/aven/releases/latest/download/Aven-windows-x64-setup.exe"><img src="https://img.shields.io/badge/Download_for_Windows-x64-111?style=for-the-badge&logo=windows&logoColor=white" alt="Download for Windows" /></a>
</p>

<p align="center">
  <a href="https://github.com/capi-git/aven/releases/latest"><img src="https://img.shields.io/github/v/release/capi-git/aven?label=latest&color=444" alt="Latest release" /></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-444" alt="MIT license" /></a>
</p>

Aven brings agent conversations, your project and a browser into one window. Use your own provider accounts and subscriptions, organize work into local workspace profiles, and keep the tools you need beside the conversation.

## What you can do

- **Keep work together:** conversations, split panes, an embedded browser, a file editor, Git changes and terminals.
- **Comment on a page:** click Comment on page, select an element and add a comment beside it. **Add to chat** puts your comment and an element screenshot in the draft for review before sending.
- **Run agents on a schedule:** Automations start agents at set times while your computer is awake and Aven is open, with ready-made examples to start from. They are grouped in a folder per project, and each run's conversation stays under its automation, out of your chats, until you choose **Open as chat**. A run tells you only when it needs you or has finished with something to review, such as a draft to publish, which it leaves as a card in your Inbox; the card's **Publish** button sends the run Aven's own answer, never text the agent wrote.
- **Guide agents:** review approvals, queue follow-ups and inspect changes.
- **Put agents together:** from **Modes** in the critter’s dialog on the message box, have two chats talk a question through ([Discuss](docs/ORCHESTRATION.md#discussions)), give one task to several agents and keep the best result ([Race](docs/RACE.md)) or let a lead agent share out the work to other agents ([Orchestrator](docs/ORCHESTRATION.md)). **Watch** any of them in a floating panel, or on a Mac in a small window of its own.
- **See where work stands:** every chat shows one word in the sidebar (Needs you, Working, Review or Shipped). Each project has a board of the features you want, opened like a browser tab: write ideas down, press **Build** to hand one to an agent, and its card moves through Building and Review to Shipped by itself, marked **Needs you** when an agent waits on you.
- **Save context:** Notes for Markdown notes, and Inbox for GitHub issues and pull requests from connected projects.
- **Make it yours:** dark and light themes, workspace colors, translucent surfaces and optional chat backgrounds.

### Publish articles from Notion

To put articles from Notion on your website every week, choose **New automation** in Automations (or the **+** on a project's folder) and the **Publish articles from Notion** template. Paste the link to the Notion page or database, pick the site's project, say where the articles go on the site ("/blog pages, like the existing ones") and, if you like, the Notion status that marks an article ready. It runs on Mondays at 09:00 unless you change it; turn on **Run now** to try it straight away.

Each run adds new or changed articles to the site as drafts, using the project's own tools: the Framer skill for a Framer site, the code for a code site. It keeps a record in `.aven/notion-articles.json` so no article is added twice, and leaves a **Ready to publish** card in your Inbox when there is something new. Nothing goes live until you press **Publish**. See [Agent tools](docs/AGENT-TOOLS.md#publish-articles-from-notion) for what the agent is told.

## Install

**Mac:** download the app for Apple Silicon Macs on macOS 13 or later, extract it and move **Aven.app** to Applications. It is signed and notarized by Apple, so it opens normally.

**Windows:** download and run the x64 installer. It is not yet Authenticode-signed, so Windows may show an unknown-publisher warning on first install. See [Aven for Windows](docs/WINDOWS.md) for checksums and the features that are still macOS-only.

Both versions download signed updates in the background and install them when you choose **Restart to update**. Aven never interrupts running agents. Intel Mac and Linux builds are not currently provided.

## Get started

1. Open Aven and choose the providers you want to connect in the first-launch setup, or later in **Settings → Provider setup**. Nothing is preselected or installed automatically.
2. For [Claude Code](https://claude.com/product/claude-code) or [Codex](https://developers.openai.com/codex/cli), review and run the install or sign-in step. Other providers link to their official guides.
3. Choose a project folder, a provider and model, and an access mode, then start a task. See [Connect your providers](docs/PROVIDER-SETUP.md) for details.

Aven needs no Aven account and does not sell model access. Subscriptions, API charges, sign-in and usage limits stay with each provider. Adapters are included for Claude Code, Codex, Cursor, Grok Build, OpenCode, Pi, omp and fx. Model lists refresh from your installed providers without an Aven release.

> [!NOTE]
> Agents can edit files and run commands according to the access mode you choose. Review it before starting a task, and use version control for projects you let agents change. Workspace profiles organize projects; they do not separate provider or GitHub accounts. For GitHub Inbox, see the [account setup guide](docs/GITHUB-ACCOUNTS.md).

## Build and contribute

Aven uses React, TypeScript, Rust and Tauri. The Mac app embeds Chromium; Windows uses WebView2.

- [Develop Aven inside Aven](docs/DEVELOPMENT.md): run `npm run dev:app` for a separate **Aven Dev** preview while your installed app stays open.
- [Chromium build guide](docs/CHROMIUM.md), [Windows build guide](docs/WINDOWS.md) and [release instructions](docs/RELEASING.md).
- [Contributing](.github/CONTRIBUTING.md) and [security reporting](.github/SECURITY.md).

Bug reports and focused pull requests are welcome.

## License and origins

Aven is licensed under [MIT](LICENSE). It began from the MIT-licensed [MonoCode](https://github.com/hardbeat920/monocode) project by Nick and contributors, and is maintained independently. Original copyright notices are preserved. See [NOTICE](NOTICE) for attribution and provider trademarks, and [Branding and compatibility](docs/BRANDING.md) for internal names that still use older identifiers.
