import React from "react";
import ReactDOM from "react-dom/client";
import { listen } from "@tauri-apps/api/event";
import { initAppearance } from "./lib/appearance";
import { useBootSplashReady } from "./lib/bootSplash";
import { initSounds } from "./lib/sounds";
import { syncBrowserEngineOptions } from "./lib/browserEngine";
import { consumeInstalledUpdate } from "./lib/updateNotice";
import { showRenderFailure } from "./lib/renderFailure";
import { preventFileDropNavigation } from "./lib/attachments";
import { watchWindowResize } from "./lib/windowResizeFlag";
import "./index.css";
import "./personal-shell.css";
import "./macos-theme.css";

// Shell webviews use DOM drops so WebKit resolves file promises and targets.
// Keep an unhandled file drop from navigating away from Aven.
window.addEventListener("dragover", preventFileDropNavigation);
window.addEventListener("drop", preventFileDropNavigation);
const stopWatchingWindowResize = watchWindowResize();
import.meta.hot?.dispose(() => {
  window.removeEventListener("dragover", preventFileDropNavigation);
  window.removeEventListener("drop", preventFileDropNavigation);
  stopWatchingWindowResize();
});

const rootOptions = {
  onUncaughtError(error: unknown, info: { componentStack?: string | null }) {
    document.getElementById("boot-splash")?.remove();
    showRenderFailure(
      document.getElementById("root") as HTMLElement,
      error,
      info.componentStack,
    );
  },
};

function showStartupFailure(error: unknown) {
  document.getElementById("boot-splash")?.remove();
  showRenderFailure(document.getElementById("root") as HTMLElement, error);
}

function BootGate({ children }: { children: React.ReactNode }) {
  useBootSplashReady(true, true);
  return children;
}

if (new URLSearchParams(window.location.search).has("workspaceMenuPanel")) {
  // Controlled menu only: never restore an App, workspace, or harness here.
  void import("./surfaces/WorkspaceMenuPanelWindow")
    .then(({ WorkspaceMenuPanelWindow }) => {
      ReactDOM.createRoot(
        document.getElementById("root") as HTMLElement,
        rootOptions,
      ).render(<WorkspaceMenuPanelWindow />);
    })
    .catch(showStartupFailure);
} else if (new URLSearchParams(window.location.search).has("accessPanel")) {
  // Access is a controlled popup. The workspace owns harnesses and defaults.
  void import("./surfaces/AccessPanelWindow")
    .then(({ AccessPanelWindow }) => {
      ReactDOM.createRoot(
        document.getElementById("root") as HTMLElement,
        rootOptions,
      ).render(<AccessPanelWindow />);
    })
    .catch(showStartupFailure);
} else if (new URLSearchParams(window.location.search).has("usagePanel")) {
  // Usage is a transient controlled view. Never restore an App or a harness here.
  void import("./surfaces/UsagePanelWindow")
    .then(({ UsagePanelWindow }) => {
      ReactDOM.createRoot(
        document.getElementById("root") as HTMLElement,
        rootOptions,
      ).render(<UsagePanelWindow />);
    })
    .catch(showStartupFailure);
} else if (new URLSearchParams(window.location.search).has("workspaceWindow")) {
  void import("./surfaces/DetachedWorkspace")
    .then(({ DetachedWorkspace }) => {
      ReactDOM.createRoot(
        document.getElementById("root") as HTMLElement,
        rootOptions,
      ).render(
        <React.StrictMode>
          <DetachedWorkspace />
        </React.StrictMode>,
      );
    })
    .catch(showStartupFailure);
} else {
  initAppearance();
  initSounds();
  syncBrowserEngineOptions();
  // Read the saved workspace while the interface bundle downloads and
  // parses; both used to run one after the other before the first paint.
  const lifecycle = import("./lib/appLifecycle");
  const bootWorkspace = lifecycle.then(({ loadBootWorkspace }) =>
    loadBootWorkspace(),
  );
  // A read failure is reported by the render path below; mark it handled so
  // an early rejection is not also logged as unhandled.
  bootWorkspace.catch(() => {});
  void Promise.all([import("./App"), lifecycle])
    .then(async ([{ default: App }, { handleQuitRequested }]) => {
      void listen("quit_requested", () => {
        void handleQuitRequested();
      });
      const { windowTransfer, resumed, history, historyCwd } =
        await bootWorkspace;
      const installedUpdate = windowTransfer ? null : consumeInstalledUpdate();
      ReactDOM.createRoot(
        document.getElementById("root") as HTMLElement,
        rootOptions,
      ).render(
        <React.StrictMode>
          <BootGate>
            <App
              windowTransfer={windowTransfer}
              resumed={resumed}
              installedUpdate={installedUpdate}
              history={history}
              historyCwd={historyCwd}
            />
          </BootGate>
        </React.StrictMode>,
      );
    })
    .catch(showStartupFailure);
}
