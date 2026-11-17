// Aven's website. No dependencies; everything here is an enhancement, and
// the page reads the same without it.

// The dotted paper behind the headline. The pointer stirs the dots near it,
// as it stirs the ink on a new chat in Aven. It draws only while something
// moves, and stays still under Reduce motion.
(function paper() {
  const canvas = document.querySelector(".paper");
  const hero = document.querySelector(".hero");
  if (!canvas || !hero) return;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  const GAP = 22;
  const REACH = 150;
  const PUSH = 9;
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)");
  const scheme = window.matchMedia("(prefers-color-scheme: light)");

  let width = 0;
  let height = 0;
  let ink = "242, 242, 240";
  let frame = 0;
  // Where the pointer is, where the stir has caught up to, and how strong
  // the stir is (0 at rest, 1 while the pointer is over the hero).
  const aim = { x: 0, y: 0, on: 0 };
  const at = { x: 0, y: 0, on: 0 };
  // While the headline writes itself the stir follows the writing: one pass
  // along each line, timed to match the styles.
  const LINE_MS = 480;
  let pass = null;

  function measure() {
    const box = canvas.getBoundingClientRect();
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    width = box.width;
    height = box.height;
    canvas.width = Math.round(width * ratio);
    canvas.height = Math.round(height * ratio);
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    ink =
      getComputedStyle(document.documentElement)
        .getPropertyValue("--ink-rgb")
        .trim() || ink;
    draw();
  }

  function draw() {
    ctx.clearRect(0, 0, width, height);
    const left = ((width % GAP) + GAP) / 2;
    const stirred = [];

    ctx.fillStyle = `rgba(${ink}, 0.13)`;
    ctx.beginPath();
    for (let y = GAP / 2; y < height; y += GAP) {
      for (let x = left; x < width; x += GAP) {
        const dx = x - at.x;
        const dy = y - at.y;
        const far = Math.hypot(dx, dy);
        if (at.on > 0.01 && far < REACH) {
          stirred.push(x, y, dx, dy, far);
          continue;
        }
        ctx.moveTo(x + 1, y);
        ctx.arc(x, y, 1, 0, Math.PI * 2);
      }
    }
    ctx.fill();

    for (let i = 0; i < stirred.length; i += 5) {
      const far = stirred[i + 4];
      const pull = (1 - far / REACH) ** 2 * at.on;
      const away = far > 0.001 ? (pull * PUSH) / far : 0;
      ctx.fillStyle = `rgba(${ink}, ${0.13 + pull * 0.6})`;
      ctx.beginPath();
      ctx.arc(
        stirred[i] + stirred[i + 2] * away,
        stirred[i + 1] + stirred[i + 3] * away,
        1 + pull * 0.9,
        0,
        Math.PI * 2,
      );
      ctx.fill();
    }
  }

  function follow(now) {
    const spent = Math.max(0, now - pass.start);
    const line = pass.lines[Math.floor(spent / LINE_MS)];
    if (!line) {
      pass = null;
      aim.on = 0;
      return;
    }
    const along = (spent % LINE_MS) / LINE_MS;
    aim.x = line.from + (line.to - line.from) * along;
    aim.y = line.y;
    aim.on = 1;
    // The writing jumps to the start of each line, and so does the stir.
    if (along < 0.1) {
      at.x = aim.x;
      at.y = aim.y;
    }
  }

  function step(now) {
    if (pass) follow(now);
    at.x += (aim.x - at.x) * 0.2;
    at.y += (aim.y - at.y) * 0.2;
    at.on += (aim.on - at.on) * 0.12;
    draw();
    const settled =
      !pass &&
      Math.abs(aim.x - at.x) < 0.3 &&
      Math.abs(aim.y - at.y) < 0.3 &&
      Math.abs(aim.on - at.on) < 0.01;
    frame = settled ? 0 : requestAnimationFrame(step);
  }

  function wake() {
    if (!frame && !reduce.matches) frame = requestAnimationFrame(step);
  }

  function written() {
    if (reduce.matches) return;
    const box = canvas.getBoundingClientRect();
    const lines = [];
    for (const line of hero.querySelectorAll("h1 .line")) {
      const edge = line.getBoundingClientRect();
      lines.push({
        from: edge.left - box.left,
        to: edge.right - box.left,
        y: edge.top - box.top + edge.height / 2,
      });
    }
    if (!lines.length) return;
    pass = { start: performance.now(), lines };
    wake();
  }

  if (document.documentElement.classList.contains("write")) written();
  else document.addEventListener("aven:write", written, { once: true });

  hero.addEventListener("pointermove", (event) => {
    if (event.pointerType === "touch") return;
    pass = null;
    const box = canvas.getBoundingClientRect();
    aim.x = event.clientX - box.left;
    aim.y = event.clientY - box.top;
    if (at.on < 0.01) {
      at.x = aim.x;
      at.y = aim.y;
    }
    aim.on = 1;
    wake();
  });

  hero.addEventListener("pointerleave", () => {
    aim.on = 0;
    wake();
  });

  new ResizeObserver(measure).observe(canvas);
  scheme.addEventListener("change", measure);
  measure();
})();

// What you scroll to comes in: up a little, each tile after its neighbour,
// and each section's name writes itself in dots. Only what is below the
// window when the page opens is held back, so nothing in view blinks, and
// only when the page's first script said that motion is wanted.
(function reveal() {
  const root = document.documentElement;
  if (!root.classList.contains("motion")) return;
  if (!window.IntersectionObserver) return;
  const pieces = document.querySelectorAll(
    [
      ".band-say",
      ".glass-tile",
      ".tiles > li",
      ".names > li",
      ".relay > li",
      ".set-name",
      ".band .wrap > .shot",
      ".band .wrap > h3",
      ".duo > *",
      ".platform",
      ".note",
      ".foot-row > *",
    ].join(","),
  );
  const names = new Map();
  const below = (piece) =>
    piece.getBoundingClientRect().top > window.innerHeight * 0.94;
  const watch = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        const piece = names.get(entry.target) || entry.target;
        piece.classList.remove("waits");
        piece.classList.add("is-seen");
        watch.unobserve(entry.target);
      }
    },
    { rootMargin: "0px 0px -4% 0px", threshold: 0.02 },
  );

  // A piece's turn among its own neighbours sets how long it waits.
  const turns = new Map();
  for (const piece of pieces) {
    if (!below(piece)) continue;
    const turn = turns.get(piece.parentElement) || 0;
    turns.set(piece.parentElement, turn + 1);
    piece.style.setProperty("--i", String(Math.min(turn, 5)));
    piece.classList.add("rise");
    watch.observe(piece);
  }
  for (const name of document.querySelectorAll(".band-name")) {
    if (!below(name)) continue;
    // A waiting name is clipped away to nothing, and nothing is never seen,
    // so the row it stands in is watched for it.
    name.classList.add("waits");
    names.set(name.parentElement, name);
    watch.observe(name.parentElement);
  }
})();

// A soft light follows the pointer across a tile, as on glass.
(function light() {
  if (!window.matchMedia("(hover: hover)").matches) return;
  const tiles = document.querySelectorAll(
    ".spec > div, .tiles > li, .names > li, .relay > li, .platform, .glass-tile",
  );
  for (const tile of tiles) tile.classList.add("glow");
  let last = null;
  function dim() {
    if (!last) return;
    last.style.removeProperty("--mx");
    last.style.removeProperty("--my");
    last = null;
  }
  document.addEventListener(
    "pointermove",
    (event) => {
      const tile =
        event.pointerType === "mouse" && event.target.closest
          ? event.target.closest(".glow")
          : null;
      if (tile !== last) dim();
      if (!tile) return;
      const box = tile.getBoundingClientRect();
      tile.style.setProperty("--mx", `${event.clientX - box.left}px`);
      tile.style.setProperty("--my", `${event.clientY - box.top}px`);
      last = tile;
    },
    { passive: true },
  );
  document.documentElement.addEventListener("pointerleave", dim);
})();

// The Glass tile's sliders set this page's own glass, as the same sliders do
// in Aven. Opacity is how solid the veil over the wallpaper is, Translucency
// is how much of the sharp sky shows through it, and Frame is how dark the
// tiles are. The sharp sky is fetched when the tile is near, not with the
// page.
(function glass() {
  const tile = document.querySelector("[data-glass]");
  if (!tile) return;
  const dials = tile.querySelector(".dials");
  const sky = document.querySelector(".sky");
  if (!dials) return;
  const root = document.documentElement;
  const FRAMES = { lighter: [0.1, 0.17], darker: [0.035, 0.075] };
  let asked = false;

  function wantSky() {
    if (asked || !sky) return;
    asked = true;
    const picture = new Image();
    picture.onload = () => {
      sky.style.backgroundImage = 'url("assets/sky.jpg")';
      sky.classList.add("is-in");
    };
    picture.src = "assets/sky.jpg";
  }

  function fill(input) {
    input.style.setProperty("--v", `${input.value}%`);
    input.nextElementSibling.textContent = `${input.value}%`;
  }

  for (const input of dials.querySelectorAll("input[data-dial]")) {
    fill(input);
    input.addEventListener("input", () => {
      fill(input);
      root.style.setProperty(
        `--${input.dataset.dial}`,
        String(Number(input.value) / 100),
      );
      if (input.dataset.dial === "clear") wantSky();
    });
  }

  const frames = [...dials.querySelectorAll("[data-frame]")];
  for (const button of frames) {
    button.addEventListener("click", () => {
      for (const each of frames) {
        each.setAttribute("aria-checked", String(each === button));
      }
      const pair = FRAMES[button.dataset.frame];
      if (pair) {
        root.style.setProperty("--tile", `rgba(var(--ink-rgb), ${pair[0]})`);
        root.style.setProperty(
          "--tile-strong",
          `rgba(var(--ink-rgb), ${pair[1]})`,
        );
      } else {
        root.style.removeProperty("--tile");
        root.style.removeProperty("--tile-strong");
      }
    });
  }

  tile.hidden = false;
  if (!window.IntersectionObserver) {
    wantSky();
    return;
  }
  const near = new IntersectionObserver(
    ([entry]) => {
      if (!entry.isIntersecting) return;
      wantSky();
      near.disconnect();
    },
    { rootMargin: "700px" },
  );
  near.observe(tile);
})();

// What moves by itself moves only while it is on screen.
(function live() {
  const all = document.querySelectorAll("[data-live]");
  if (!all.length || !window.IntersectionObserver) return;
  const watch = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        entry.target.classList.toggle("is-away", !entry.isIntersecting);
      }
    },
    { threshold: 0.2 },
  );
  for (const each of all) {
    each.classList.add("is-live", "is-away");
    watch.observe(each);
  }
})();

// Beside each example automation, the day it would next run by the visitor's
// own clock.
(function next() {
  const now = new Date();
  for (const spot of document.querySelectorAll("[data-next]")) {
    const [days, time] = spot.dataset.next.split(" ");
    const wanted = days.split(",").map(Number);
    const [hour, minute] = time.split(":").map(Number);
    for (let ahead = 0; ahead < 8; ahead += 1) {
      const run = new Date(
        now.getFullYear(),
        now.getMonth(),
        now.getDate() + ahead,
        hour,
        minute,
      );
      if (run <= now || !wanted.includes(run.getDay())) continue;
      const day =
        ahead === 0
          ? "today"
          : ahead === 1
            ? "tomorrow"
            : run.toLocaleDateString("en-GB", { weekday: "long" });
      spot.textContent = `Next: ${day}`;
      break;
    }
  }
})();

// The walk-through at the top of the page: five pictures of one real task.
// Each step's picture shows while its tab fills, then the next comes in. It
// waits while the pointer is on the picture or the picture is off screen, and
// it stops for good once you pick a step yourself. Under Reduce motion nothing
// moves by itself. The later pictures are fetched one ahead, not at the start.
(function tour() {
  const root = document.querySelector("[data-tour]");
  if (!root) return;
  const steps = [...root.querySelectorAll(".tour-steps button")];
  const shot = root.querySelector(".shot");
  const pan = root.querySelector(".shot-pan");
  const first = root.querySelector(".scene");
  const say = root.querySelector(".tour-say");
  if (steps.length < 2 || !shot || !pan || !first || !say) return;

  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)");
  const scenes = steps.map((step, index) => {
    if (index === 0) return first;
    const scene = new Image();
    scene.className = "scene more";
    scene.alt = step.dataset.alt || "";
    scene.width = first.width;
    scene.height = first.height;
    scene.decoding = "async";
    scene.setAttribute("aria-hidden", "true");
    return scene;
  });
  let at = 0;
  let wanted = 0;
  let fade = null;

  function fetched(index) {
    const scene = scenes[index];
    if (!scene.isConnected) {
      scene.src = steps[index].dataset.scene;
      pan.append(scene);
    }
    if (scene.complete && scene.naturalWidth) return Promise.resolve();
    return scene.decode ? scene.decode().catch(() => {}) : Promise.resolve();
  }

  // On a phone the picture is wider than its frame, so each step slides to
  // the part its words are about.
  function slide(index, smooth) {
    const room = shot.scrollWidth - shot.clientWidth;
    if (room < 2) return;
    const left = room * Number(steps[index].dataset.focus || 0);
    shot.scrollTo({ left, behavior: smooth ? "smooth" : "auto" });
  }

  function settle() {
    if (fade) fade.cancel();
    fade = null;
    scenes.forEach((scene, index) => {
      scene.classList.remove("is-in");
      scene.classList.toggle("is-on", index === at);
      if (index === at) scene.removeAttribute("aria-hidden");
      else scene.setAttribute("aria-hidden", "true");
    });
  }

  function show(index) {
    index = (index + scenes.length) % scenes.length;
    wanted = index;
    fetched(index).then(() => {
      if (wanted !== index || index === at) return;
      settle();
      const scene = scenes[index];
      const calm = reduce.matches;
      at = index;
      steps.forEach((step, i) => {
        if (i === at) step.setAttribute("aria-current", "step");
        else step.removeAttribute("aria-current");
      });
      say.textContent = steps[at].dataset.say || "";
      slide(at, !calm);
      if (calm || !scene.animate) {
        settle();
      } else {
        scene.classList.add("is-in");
        fade = scene.animate([{ opacity: 0 }, { opacity: 1 }], {
          duration: 560,
          easing: "ease",
        });
        fade.onfinish = settle;
      }
      if (root.classList.contains("is-playing")) {
        fetched((at + 1) % scenes.length);
      }
    });
  }

  function stop() {
    root.classList.remove("is-playing", "is-paused");
  }

  steps.forEach((step, index) => {
    step.addEventListener("click", () => {
      stop();
      say.setAttribute("aria-live", "polite");
      show(index);
    });
  });

  root.addEventListener("animationend", (event) => {
    if (event.animationName !== "tour-fill") return;
    if (root.classList.contains("is-playing")) show(at + 1);
  });

  shot.addEventListener("pointerenter", (event) => {
    if (event.pointerType === "mouse") root.classList.add("is-paused");
  });
  shot.addEventListener("pointerleave", () => {
    root.classList.remove("is-paused");
  });
  // A finger on the picture means you are looking round it yourself.
  shot.addEventListener("pointerdown", (event) => {
    if (event.pointerType !== "mouse") stop();
  });

  if (window.IntersectionObserver) {
    root.classList.add("is-away");
    new IntersectionObserver(
      ([entry]) => root.classList.toggle("is-away", !entry.isIntersecting),
      { threshold: 0.12 },
    ).observe(shot);
  }

  root.classList.add("is-live");
  slide(0, false);
  if (!reduce.matches) {
    root.classList.add("is-playing");
    fetched(1);
  }
})();

// The top row shows which section is at the middle of the window. The lit
// tab slides from one name to the next.
(function here() {
  const nav = document.querySelector(".top-nav");
  if (!nav || !window.IntersectionObserver) return;
  const links = new Map();
  for (const link of nav.querySelectorAll('a[href^="#"]')) {
    const section = document.getElementById(link.hash.slice(1));
    if (section) links.set(section, link);
  }
  if (!links.size) return;

  const glow = document.createElement("span");
  glow.className = "nav-glow";
  glow.setAttribute("aria-hidden", "true");
  nav.prepend(glow);
  nav.classList.add("has-glow");

  function place() {
    const link = nav.querySelector("a[aria-current]");
    if (!link) {
      glow.classList.remove("is-on");
      return;
    }
    // Coming on, it appears where it belongs; only after that does it slide.
    const fresh = !glow.classList.contains("is-on");
    if (fresh) glow.style.transition = "none";
    glow.style.setProperty("--x", `${link.offsetLeft}px`);
    glow.style.setProperty("--y", `${link.offsetTop}px`);
    glow.style.setProperty("--w", `${link.offsetWidth}px`);
    glow.style.setProperty("--h", `${link.offsetHeight}px`);
    if (fresh) {
      void glow.offsetWidth;
      glow.style.transition = "";
    }
    glow.classList.add("is-on");
  }

  const watch = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        const link = links.get(entry.target);
        if (entry.isIntersecting) link.setAttribute("aria-current", "true");
        else link.removeAttribute("aria-current");
      }
      place();
    },
    { rootMargin: "-40% 0px -59% 0px" },
  );
  for (const section of links.keys()) watch.observe(section);
  window.addEventListener("resize", place);
})();

// On a phone each picture slides sideways. Some start part of the way
// along, or at their right-hand side, where the part the words describe is.
(function pan() {
  for (const frame of document.querySelectorAll("[data-pan]")) {
    const along = frame.dataset.pan === "end" ? 1 : Number(frame.dataset.pan);
    const set = () => {
      frame.scrollLeft = (frame.scrollWidth - frame.clientWidth) * along;
    };
    set();
    // A picture not yet loaded has no width to slide along.
    const picture = frame.querySelector("img");
    if (picture && !picture.complete) {
      picture.addEventListener("load", set, { once: true });
    }
  }
})();

// The download for the visitor's own computer is the filled button.
(function platform() {
  const windows = /Windows/i.test(navigator.userAgent);
  if (!windows) return;
  for (const link of document.querySelectorAll("a.button[data-os]")) {
    link.classList.toggle("plain", link.dataset.os !== "windows");
  }
})();

// Show the newest release's number. The page already names one, so a failed
// request changes nothing.
(function version() {
  const spots = document.querySelectorAll("[data-version]");
  if (!spots.length || !window.fetch) return;
  fetch("https://api.github.com/repos/capi-git/aven/releases/latest", {
    headers: { Accept: "application/vnd.github+json" },
  })
    .then((reply) => (reply.ok ? reply.json() : null))
    .then((release) => {
      const number =
        release && /^v?(\d+\.\d+\.\d+)$/.exec(release.tag_name || "");
      if (!number) return;
      for (const spot of spots) spot.textContent = number[1];
    })
    .catch(() => {});
})();

// Copy the build commands.
(function copy() {
  for (const button of document.querySelectorAll("[data-copy]")) {
    const code = button.parentElement.querySelector("code");
    if (!code || !navigator.clipboard) {
      button.hidden = true;
      continue;
    }
    button.addEventListener("click", () => {
      navigator.clipboard.writeText(code.textContent).then(() => {
        button.textContent = "Copied";
        setTimeout(() => (button.textContent = "Copy"), 1600);
      });
    });
  }
})();
