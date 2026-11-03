import { waitFor } from "./devSmoke";

type PinTabOptions = { newProjectTask: (path: string) => void };

const STRIP = '.workspace-status-strip-content [aria-label="Workspace tabs"]';

function slots(): HTMLElement[] {
  return [
    ...document.querySelectorAll<HTMLElement>(`${STRIP} [data-surface-tab-id]`),
  ];
}

async function pickFromTabMenu(id: string, label: string) {
  const tab = slots().find((slot) => slot.dataset.surfaceTabId === id);
  if (!tab) throw new Error(`tab ${id} left the strip`);
  tab.dispatchEvent(
    new MouseEvent("contextmenu", { bubbles: true, cancelable: true }),
  );
  const row = await waitFor(
    () =>
      [
        ...document.querySelectorAll<HTMLButtonElement>('[role="menuitem"]'),
      ].find((item) => item.textContent === label) ?? null,
    5_000,
    `"${label}" in the tab's menu`,
  );
  row.click();
}

/**
 * Aven Dev's real-app check of a pinned tab: it moves to the start of the
 * strip, shrinks to its mark without a close button, and comes back as an
 * ordinary tab when unpinned.
 */
export async function checkPinnedTab(
  path: string,
  get: () => PinTabOptions,
): Promise<void> {
  get().newProjectTask(path);
  await waitFor(
    () => (slots().length >= 2 ? true : null),
    10_000,
    "two tabs on the strip",
  );
  const id = slots().at(-1)!.dataset.surfaceTabId!;
  await pickFromTabMenu(id, "Pin tab");
  const pinned = await waitFor(
    () => {
      const first = slots()[0];
      return first?.dataset.surfaceTabId === id &&
        first.closest("[data-pinned]")
        ? first
        : null;
    },
    5_000,
    "the pinned tab at the start of the strip",
  );
  const width = pinned.getBoundingClientRect().width;
  if (width > 40) throw new Error(`a pinned tab is ${width}px wide`);
  if (pinned.querySelector(".aven-tab-close"))
    throw new Error("a pinned tab still has a close button");
  await pickFromTabMenu(id, "Unpin tab");
  await waitFor(
    () =>
      slots()
        .find((slot) => slot.dataset.surfaceTabId === id)
        ?.closest("[data-pinned]")
        ? null
        : true,
    5_000,
    "the tab to unpin",
  );
}
