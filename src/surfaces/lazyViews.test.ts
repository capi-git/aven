// @vitest-environment happy-dom
import { act, createElement, type ComponentType } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const loaded = vi.hoisted(() => new Set<string>());
function stand(name: string) {
  loaded.add(name);
  return () => createElement("div", { "data-view": name });
}
vi.mock("./SearchView", () => ({ SearchView: stand("search") }));
vi.mock("./SettingsView", () => ({ SettingsView: stand("settings") }));
vi.mock("./InboxView", () => ({ InboxView: stand("inbox") }));
vi.mock("./AutomationsView", () => ({ AutomationsView: stand("automations") }));
vi.mock("./NotesView", () => ({ NotesView: stand("notes") }));
vi.mock("../chrome/CommandPalette", () => ({
  CommandPalette: stand("palette"),
}));
vi.mock("../chrome/WhatsNewDialog", () => ({
  WhatsNewDialog: stand("whats-new"),
}));
vi.mock("./ProviderSetup", () => ({
  ProviderSetupDialog: stand("provider-setup"),
}));

import * as views from "./lazyViews";

let root: Root;
let container: HTMLDivElement;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

it("preloads the views opened from the sidebar, menus and shortcuts", async () => {
  expect(loaded.size).toBe(0);
  await views.preloadLazyViews();
  expect([...loaded].sort()).toEqual([
    "automations",
    "inbox",
    "notes",
    "palette",
    "search",
    "settings",
  ]);

  // Each now renders in the same pass that opens it, with no blank frame.
  // The stand-ins ignore their props.
  const preloaded = {
    search: views.SearchView,
    settings: views.SettingsView,
    inbox: views.InboxView,
    automations: views.AutomationsView,
    notes: views.NotesView,
    palette: views.CommandPalette,
  } as Record<string, ComponentType<object>>;
  for (const [name, View] of Object.entries(preloaded)) {
    act(() =>
      root.render(
        createElement(views.LazyViewSlot, {
          label: name,
          children: createElement(View),
        }),
      ),
    );
    expect(container.querySelector(`[data-view="${name}"]`)).not.toBeNull();
  }
});
