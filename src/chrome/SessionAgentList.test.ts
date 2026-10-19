import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { SessionAgentList } from "./SessionAgentList";

it("shows a subagent's progress with Aven's own folder as Aven data", () => {
  const markup = renderToStaticMarkup(
    createElement(SessionAgentList, {
      agents: [
        {
          id: "t1",
          title: "Check the preview",
          status: "running",
          detail:
            "Reading ~/Library/Application Support/com.capi.monocode.personal/turn-shots/s1/1792438599200-preview-login.png",
        },
      ],
    }),
  );
  expect(markup).toContain(
    "Reading Aven data/turn-shots/s1/1792438599200-preview-login.png",
  );
  expect(markup).not.toContain("com.capi.monocode.personal");
});
