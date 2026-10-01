# Connect your providers

Aven uses your provider's CLI and account on macOS and Windows. There is no separate Aven account, and Aven does not include provider subscriptions or usage credits.

## Choose and connect

A fresh installation offers setup on first launch. Existing projects and conversations keep their usual launch flow. Open **Settings → Provider setup** whenever you want to add a provider or troubleshoot one.

1. Choose the providers you want to use. The initial selection is empty, even if some CLIs are already installed. Selecting a provider does not install software, sign in, or send a message.
2. Select **Continue**. Aven checks only the providers you chose.
3. For Claude Code or Codex, select **Install CLI** or **Sign in**, review the action, and explicitly select **Run installation** or **Start sign-in**. Installation uses that provider's official installer for your operating system. Complete sign-in through the provider's terminal or browser prompts.
4. When the setup command finishes, select **Close & check**. Closing this terminal stops an unfinished setup command.
5. For Claude, you can explicitly select **Send test message**. For Codex and other providers, start a task to verify that the account can respond. Then choose a folder and start your work in Aven.

Cursor, Grok Build, OpenCode, Pi, omp and fx have links to their official installation and connection guides. This first setup implementation detects their CLIs but does not automatically check their authentication or run their installers.

You can select **Set up later**, close the welcome dialog, or continue before connecting everything. Your provider choices and deferral are saved locally. Settings can reopen setup with those choices; connection status is checked again rather than trusted from a previous visit.

## Understand the checks

Installation, sign-in and a successful response are separate checks:

| Status | What it establishes |
| --- | --- |
| Not installed | Aven did not find this provider's CLI. |
| Installed · connection not checked | Aven found the CLI, but this provider's sign-in cannot be checked automatically. |
| Sign-in needed | Claude or Codex reports that sign-in is required. |
| Signed in | Claude or Codex's local authentication check passed. A real response is still needed to confirm account access and usage availability. |
| Connection tested | Claude successfully answered the optional setup test message. |
| Needs attention | A check failed or timed out; follow the displayed recovery message. |

The optional Claude test sends a short message using your provider's normal usage allowance. It runs without tools, hooks or project files in a temporary folder. No test message is sent automatically. Codex's initial setup has no equivalent test button; verify its connection with your first task.

Setup stores only your selected provider IDs and whether you completed or deferred it. Aven does not save credentials, raw authentication-check output or setup-terminal contents into workspace state. The provider manages its own credentials and authentication storage.

## If an installed CLI is not found

Select **Check again** first. Aven searches common installation locations afresh, including the official Codex Windows installation location. If you installed to a custom command search path (PATH), finish active work and reopen Aven so it can inherit that change.

On Windows, follow the provider's Windows-specific guide if its installer or sign-in needs additional prerequisites. Do not assume a successful installation or **Signed in** status guarantees an authenticated task. See [Windows setup and verification limits](WINDOWS.md).
