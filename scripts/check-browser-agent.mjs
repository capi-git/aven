#!/usr/bin/env node
// Protocol check for Aven's agent browser actions. Serves the fixture pages in
// tests/fixtures/browser-agent on 127.0.0.1, opens them in a headless
// Chromium-based browser and drives them with the real agent DOM script
// (src-tauri/src/browser_agent_dom.js) and the same DevTools sequence that
// Page::PointerAction and Page::Upload use in src-tauri/chromium/supermono_chromium.mm:
// aim, move, confirm, press, release, verify. File choosers are answered with
// DevTools' file chooser interception, standing in for CEF's dialog handler.
//
// Usage: node scripts/check-browser-agent.mjs [--browser PATH]
// The default browser is Brave; AVEN_CHECK_BROWSER also sets the path.
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, normalize, sep } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const fixtures = join(root, "tests", "fixtures", "browser-agent");
const domScript = readFileSync(
  join(root, "src-tauri", "src", "browser_agent_dom.js"),
  "utf8",
);
const argument = process.argv.indexOf("--browser");
const browserPath =
  (argument > 0 && process.argv[argument + 1]) ||
  process.env.AVEN_CHECK_BROWSER ||
  "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser";
if (!existsSync(browserPath)) {
  console.error(
    `No browser at ${browserPath}. Pass --browser with a Chromium-based browser.`,
  );
  process.exit(2);
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function serve() {
  const server = createServer((request, response) => {
    const path = normalize(
      join(
        fixtures,
        decodeURIComponent(new URL(request.url, "http://x").pathname),
      ),
    );
    if (!path.startsWith(fixtures + sep) || !existsSync(path)) {
      response.writeHead(404).end();
      return;
    }
    response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    response.end(readFileSync(path));
  });
  return new Promise((resolve) =>
    server.listen(0, "127.0.0.1", () => resolve(server)),
  );
}

async function launch(scratch) {
  const profile = join(scratch, "profile");
  const child = spawn(
    browserPath,
    [
      "--headless=new",
      "--remote-debugging-port=0",
      `--user-data-dir=${profile}`,
      "--no-first-run",
      "--no-default-browser-check",
      "--disable-extensions",
      "--window-size=1000,800",
      "about:blank",
    ],
    { stdio: ["ignore", "ignore", "pipe"] },
  );
  const url = await new Promise((resolve, reject) => {
    let output = "";
    child.stderr.on("data", (data) => {
      output += data;
      const found = output.match(/DevTools listening on (ws:\/\/\S+)/);
      if (found) resolve(found[1]);
    });
    child.on("exit", () => reject(new Error(`The browser exited: ${output}`)));
    setTimeout(() => reject(new Error("The browser did not start")), 20000);
  });
  const socket = new WebSocket(url);
  await new Promise((resolve) =>
    socket.addEventListener("open", resolve, { once: true }),
  );
  let sequence = 0;
  const pending = new Map();
  const listeners = new Set();
  socket.addEventListener("message", (event) => {
    const message = JSON.parse(event.data);
    if (message.id && pending.has(message.id)) {
      const { resolve, reject } = pending.get(message.id);
      pending.delete(message.id);
      if (message.error) reject(new Error(JSON.stringify(message.error)));
      else resolve(message.result);
    } else for (const listener of listeners) listener(message);
  });
  const send = (method, params = {}, sessionId) =>
    new Promise((resolve, reject) => {
      const id = ++sequence;
      pending.set(id, { resolve, reject });
      socket.send(JSON.stringify({ id, method, params, sessionId }));
    });
  return {
    send,
    listeners,
    close() {
      socket.close();
      child.kill();
    },
  };
}

/** One fixture page with the agent's isolated world, like Page in the host. */
async function openPage(browser, url, { zoom = 1, pinch = null } = {}) {
  const { targetId } = await browser.send("Target.createTarget", {
    url: "about:blank",
  });
  const { sessionId } = await browser.send("Target.attachToTarget", {
    targetId,
    flatten: true,
  });
  const send = (method, params) => browser.send(method, params, sessionId);
  const choosers = [];
  browser.listeners.add((message) => {
    if (message.sessionId !== sessionId) return;
    if (message.method === "Page.fileChooserOpened")
      choosers.push(message.params);
  });
  await send("Page.enable");
  await send("Runtime.enable");
  await send("DOM.enable");
  await send("Page.setInterceptFileChooserDialog", { enabled: true });
  const loaded = new Promise((resolve) => {
    const listener = (message) => {
      if (
        message.sessionId === sessionId &&
        message.method === "Page.loadEventFired"
      ) {
        browser.listeners.delete(listener);
        resolve();
      }
    };
    browser.listeners.add(listener);
  });
  await send("Page.navigate", { url });
  await loaded;
  if (zoom !== 1)
    // The host's per-tab zoom: Emulation scale, as in Page::ApplyZoom.
    await send("Emulation.setDeviceMetricsOverride", {
      width: 0,
      height: 0,
      deviceScaleFactor: zoom,
      mobile: false,
      scale: zoom,
      dontSetVisibleSize: true,
    });
  if (pinch) {
    await send("Emulation.setPageScaleFactor", { pageScaleFactor: pinch });
    await sleep(200);
  }
  const tree = await send("Page.getFrameTree");
  const world = await send("Page.createIsolatedWorld", {
    frameId: tree.frameTree.frame.id,
    worldName: "supermono-agent",
    grantUniveralAccess: false,
  });
  const page = {
    zoom,
    send,
    choosers,
    async dom(operation) {
      const response = await send("Runtime.evaluate", {
        expression: `${domScript}(${JSON.stringify(operation)})`,
        contextId: world.executionContextId,
        returnByValue: true,
        userGesture: true,
      });
      if (response.exceptionDetails)
        throw new Error(JSON.stringify(response.exceptionDetails));
      const result = JSON.parse(response.result.value);
      if (result.__supermonoAgentError)
        throw new Error(result.__supermonoAgentError);
      return result;
    },
    async log() {
      const response = await send("Runtime.evaluate", {
        expression: "JSON.stringify(window.agentLog || [])",
        returnByValue: true,
      });
      return JSON.parse(response.result.value);
    },
    async snapshot() {
      return page.dom({ action: "snapshot", generation: `g${Date.now()}` });
    },
    async find(predicate) {
      const snapshot = await page.snapshot();
      const found = snapshot.elements.find(predicate);
      if (!found) throw new Error("Element not found in snapshot");
      return found;
    },
    mouse(type, point, extra = {}) {
      return send("Input.dispatchMouseEvent", {
        type,
        x: point.x * zoom,
        y: point.y * zoom,
        button: type === "mouseMoved" ? "none" : "left",
        buttons: type === "mousePressed" ? 1 : 0,
        clickCount: type === "mouseMoved" ? 0 : 1,
        ...extra,
      });
    },
  };
  return page;
}

/** The host's pointer sequence for click, hover and upload. */
async function pointerAction(page, operation) {
  const aimed = await page.dom({ ...operation, pointer: true });
  if (aimed.method !== "pointer") return aimed;
  // Hover first: menus and row actions may appear under the pointer.
  await page.mouse("mouseMoved", aimed.point);
  await sleep(60);
  const confirmed = await page.dom({
    ...operation,
    pointer: true,
    phase: "confirm",
    point: aimed.point,
  });
  if (confirmed.method !== "pointer") return confirmed;
  // Move again so whatever appeared under the pointer gets its hover.
  await page.mouse("mouseMoved", confirmed.point);
  if (operation.action === "hover") return confirmed;
  await sleep(30);
  await page.mouse("mousePressed", confirmed.point);
  await sleep(40);
  await page.mouse("mouseReleased", confirmed.point);
  const verified = await page.dom({
    action: "pointer-verify",
    ref: operation.ref,
  });
  if (verified.known && !verified.pressed) {
    const fallback = await page.dom({ ...operation, pointer: false });
    return { ...fallback, fellBack: true };
  }
  return { ...confirmed, ...verified };
}

/** The host's upload: arm, click, answer the chooser that opens. */
async function upload(page, ref, files) {
  page.choosers.length = 0;
  const clicked = await pointerAction(page, { action: "upload", ref });
  for (let waited = 0; !page.choosers.length && waited < 2000; waited += 50)
    await sleep(50);
  const chooser = page.choosers.shift();
  if (!chooser) return { clicked, opened: false };
  await page.send("DOM.setFileInputFiles", {
    files,
    backendNodeId: chooser.backendNodeId,
  });
  await sleep(50);
  return { clicked, opened: true, mode: chooser.mode };
}

const results = [];
async function check(name, run) {
  try {
    await run();
    results.push({ name, ok: true });
    console.log(`ok   ${name}`);
  } catch (error) {
    results.push({ name, ok: false });
    console.log(`FAIL ${name}: ${error.message}`);
  }
}
function expect(condition, message) {
  if (!condition) throw new Error(message);
}

const scratch = mkdtempSync(join(tmpdir(), "aven-browser-check-"));
const server = await serve();
const base = `http://127.0.0.1:${server.address().port}`;
const browser = await launch(scratch);
try {
  for (const view of [
    { label: "", options: {} },
    { label: " (125% zoom)", options: { zoom: 1.25 } },
    { label: " (pinch zoom)", options: { pinch: 1.5 } },
  ]) {
    await check(
      `pointerdown menu opens and its item is chosen${view.label}`,
      async () => {
        const page = await openPage(
          browser,
          `${base}/pointerdown-menu.html`,
          view.options,
        );
        const trigger = await page.find((item) => item.label === "Add");
        expect(
          trigger.popup === "menu" && trigger.expanded === false,
          "trigger state",
        );
        const opened = await pointerAction(page, {
          action: "click",
          ref: trigger.ref,
        });
        expect(
          opened.method === "pointer" && opened.pressed,
          `method ${JSON.stringify(opened)}`,
        );
        const item = await page.find(
          (entry) => entry.role === "menuitem" && entry.label === "Upload file",
        );
        const chosen = await pointerAction(page, {
          action: "click",
          ref: item.ref,
        });
        expect(chosen.method === "pointer", "item method");
        const log = await page.log();
        expect(
          log.includes("trigger:pointerdown") &&
            log.includes("selected:Upload file"),
          JSON.stringify(log),
        );
      },
    );
    await check(
      `a click in the transformed, scrolled box lands inside it${view.label}`,
      async () => {
        const page = await openPage(
          browser,
          `${base}/transformed.html`,
          view.options,
        );
        const button = await page.find((item) => item.label === "Publish");
        const result = await pointerAction(page, {
          action: "click",
          ref: button.ref,
        });
        const log = await page.log();
        expect(
          result.method === "pointer" && result.onTarget,
          JSON.stringify(result),
        );
        expect(
          log.join() === "pointerdown:inside,click:trusted",
          JSON.stringify(log),
        );
      },
    );
  }

  await check(
    "element.click() alone cannot open a pointerdown menu (the old fallback)",
    async () => {
      const page = await openPage(browser, `${base}/pointerdown-menu.html`);
      const trigger = await page.find((item) => item.label === "Add");
      const result = await page.dom({ action: "click", ref: trigger.ref });
      expect(result.method === "element", "method");
      const log = await page.log();
      expect(!log.includes("trigger:pointerdown"), JSON.stringify(log));
      const snapshot = await page.snapshot();
      expect(
        !snapshot.elements.some((item) => item.role === "menuitem"),
        "menu opened",
      );
    },
  );

  await check(
    "portal menu items take a trusted click; a covered control reports its cover",
    async () => {
      const page = await openPage(browser, `${base}/portal-menu.html`);
      const options = await page.find((item) => item.label === "Options");
      await pointerAction(page, { action: "click", ref: options.ref });
      const rename = await page.find((item) => item.label === "Rename");
      const renamed = await pointerAction(page, {
        action: "click",
        ref: rename.ref,
      });
      expect(renamed.method === "pointer", JSON.stringify(renamed));
      await pointerAction(page, {
        action: "click",
        ref: (await page.find((item) => item.label === "Options")).ref,
      });
      const behind = await page.find(
        (item) => item.label === "Behind the overlay",
      );
      const covered = await pointerAction(page, {
        action: "click",
        ref: behind.ref,
      });
      expect(
        covered.method === "element" && /overlay/.test(covered.coveredBy || ""),
        JSON.stringify(covered),
      );
      const log = await page.log();
      expect(
        log.includes("item:rename:trusted") && log.includes("behind:direct"),
        JSON.stringify(log),
      );
    },
  );

  await check(
    "a control revealed on hover is listed, hovered and clicked with a real pointer",
    async () => {
      const page = await openPage(browser, `${base}/hover-reveal.html`);
      const remove = await page.find(
        (item) => item.label === "Delete llms.txt",
      );
      expect(remove.hidden === true, "listed as hidden");
      const result = await pointerAction(page, {
        action: "click",
        ref: remove.ref,
      });
      expect(
        result.method === "pointer" && result.pressed && result.onTarget,
        JSON.stringify(result),
      );
      const hovered = await pointerAction(page, {
        action: "hover",
        ref: (await page.find((item) => item.label === "Delete robots.txt"))
          .ref,
      });
      expect(hovered.hovered === true, JSON.stringify(hovered));
      const shown = await page.find(
        (item) => item.label === "Delete robots.txt",
      );
      expect(!shown.hidden, "revealed after hover");
      const log = await page.log();
      expect(
        log.includes("hover:first") &&
          log.includes("clicked:Delete llms.txt:trusted"),
        JSON.stringify(log),
      );
    },
  );

  await check(
    "a same-site frame's controls are listed, clicked and filled",
    async () => {
      const page = await openPage(browser, `${base}/iframe.html`);
      const save = await page.find((item) => item.label === "Save settings");
      expect(save.frame === "Site settings", JSON.stringify(save));
      const result = await pointerAction(page, {
        action: "click",
        ref: save.ref,
      });
      expect(
        result.method === "pointer" && result.onTarget,
        JSON.stringify(result),
      );
      const name = await page.find((item) => item.label === "Site name");
      const fill = await page.dom({
        action: "fill",
        ref: name.ref,
        value: "Aven",
        native: true,
      });
      expect(fill.method === "insert", JSON.stringify(fill));
      await page.send("Input.insertText", { text: "Aven" });
      const verify = await page.dom({
        action: "fill-verify",
        ref: name.ref,
        value: "Aven",
      });
      expect(verify.matches, "frame fill");
      const log = await page.log();
      expect(
        log.join() === "frame:pointerdown,frame:click:trusted",
        JSON.stringify(log),
      );
    },
  );

  await check(
    "upload answers the choosers of a file input and of a button",
    async () => {
      const page = await openPage(browser, `${base}/upload.html`);
      const files = [join(scratch, "llms.txt"), join(scratch, "notes.txt")];
      for (const file of files) writeFileSync(file, "# Aven\n");
      const logo = await page.find((item) => item.label.startsWith("Logo"));
      expect(
        logo.accept === ".png,.svg" && logo.multiple === false,
        JSON.stringify(logo),
      );
      const check = await page.dom({ action: "upload-check", ref: logo.ref });
      expect(
        check.fileInput && check.multiple === false,
        JSON.stringify(check),
      );
      let result = await upload(page, logo.ref, [files[0]]);
      expect(
        result.opened && result.clicked.method === "pointer",
        JSON.stringify(result),
      );
      const add = await page.find((item) => item.label === "Add");
      result = await upload(page, add.ref, files);
      expect(
        result.opened && result.mode === "selectMultiple",
        JSON.stringify(result),
      );
      const hidden = (await page.snapshot()).elements.find(
        (item) => item.type === "file" && item.hidden,
      );
      expect(hidden && hidden.multiple, "hidden input listed");
      result = await upload(page, hidden.ref, [files[1]]);
      expect(
        result.opened && result.clicked.method === "element",
        JSON.stringify(result),
      );
      const log = await page.log();
      expect(
        log.join("|") ===
          "direct:llms.txt|hidden:llms.txt,notes.txt|hidden:notes.txt",
        JSON.stringify(log),
      );
      let refused = "";
      const input = await page.find((item) => item.label.startsWith("Logo"));
      await page
        .dom({ action: "click", ref: input.ref })
        .catch((error) => (refused = error.message));
      expect(/upload action/.test(refused), refused);
    },
  );
} finally {
  browser.close();
  server.close();
  setTimeout(() => rmSync(scratch, { recursive: true, force: true }), 500);
}
const failed = results.filter((result) => !result.ok).length;
console.log(
  `${results.length - failed} of ${results.length} browser agent checks passed`,
);
process.exitCode = failed ? 1 : 0;
