// @vitest-environment happy-dom
import { expect, it } from "vitest";
import { pageHeadings } from "./settingsHeadings";

it("lists the open settings page's group headings in order", () => {
  document.body.innerHTML = `
    <div data-app-settings>
      <div class="settings-content">
        <header class="settings-page-header"><h1>Appearance</h1></header>
        <section class="settings-group" id="a">
          <header class="settings-group-header"><h2>Theme &amp; colour</h2></header>
        </section>
        <h2 class="settings-heading">Providers</h2>
        <section class="settings-group">
          <header class="settings-group-header"><h2> </h2></header>
        </section>
      </div>
    </div>`;
  const headings = pageHeadings(document);
  expect(headings.map((h) => h.title)).toEqual(["Theme & colour", "Providers"]);
  expect(headings[0].element.id).toBe("a");
  document.body.innerHTML = "";
  expect(pageHeadings(document)).toEqual([]);
});
