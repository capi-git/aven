export type PageHeading = { title: string; element: HTMLElement };

/**
 * The group headings of the settings page on screen, in order: each group's
 * title and each plain section heading. Empty titles are skipped.
 */
export function pageHeadings(root: ParentNode): PageHeading[] {
  const page = root.querySelector("[data-app-settings] .settings-content");
  if (!page) return [];
  return [
    ...page.querySelectorAll<HTMLElement>(
      ".settings-group-header h2, h2.settings-heading",
    ),
  ]
    .map((element) => ({
      title: element.textContent?.trim() ?? "",
      element: element.closest<HTMLElement>(".settings-group") ?? element,
    }))
    .filter((heading) => heading.title.length > 0);
}
