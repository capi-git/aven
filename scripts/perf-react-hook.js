// Speed test only (`dev-aven.py --perf`): React's DevTools hook, installed in
// the page before any module so react-dom reports each commit. It sums each
// component's own render time while src/lib/devPerfReact.ts records.
(function () {
  var PERFORMED_WORK = 1;
  var state = {
    recording: null,
    commits: 0,
    phases: {},
    effects: new Map(),
    marks: [],
    overheadMs: 0,
  };
  function nameOf(fiber) {
    var type = fiber.elementType || fiber.type;
    if (!type || typeof type === "string") return null;
    return (
      type.displayName ||
      type.name ||
      (type.type && type.type.name) ||
      (type.render && type.render.name) ||
      null
    );
  }
  // Each committed fiber's own time is its actualDuration minus its
  // children's, as React DevTools computes it. Subtrees React skipped keep
  // their old fibers (the child pointer is unchanged), so they are not
  // walked. Time in host elements goes to the nearest named component.
  function collect(root, totals) {
    var stack = [{ fiber: root, owner: "(root)" }];
    while (stack.length) {
      var item = stack.pop();
      var fiber = item.fiber;
      var reused = fiber.alternate && fiber.child === fiber.alternate.child;
      var childTime = 0;
      if (!reused) {
        for (var child = fiber.child; child; child = child.sibling) {
          childTime += child.actualDuration > 0 ? child.actualDuration : 0;
        }
      }
      var own =
        (fiber.actualDuration > 0 ? fiber.actualDuration : 0) - childTime;
      var name = nameOf(fiber);
      var owner = name || item.owner;
      if (own > 0) {
        var entry = totals.get(owner) || { ms: 0, renders: 0 };
        entry.ms += own;
        if (name && fiber.flags & PERFORMED_WORK) entry.renders += 1;
        totals.set(owner, entry);
      }
      if (!reused) {
        for (var next = fiber.child; next; next = next.sibling) {
          stack.push({ fiber: next, owner: owner });
        }
      }
    }
  }
  // React's scheduling-profiler hooks (profiling builds): time each phase of
  // a commit and each component's effects.
  var phaseStart = {};
  var effectStart = [];
  function phase(name) {
    return {
      start: function () {
        if (state.recording) phaseStart[name] = performance.now();
      },
      stop: function () {
        if (!state.recording || phaseStart[name] === undefined) return;
        state.phases[name] =
          (state.phases[name] || 0) + performance.now() - phaseStart[name];
        phaseStart[name] = undefined;
      },
    };
  }
  function effect(kind) {
    return {
      start: function (fiber) {
        if (state.recording)
          effectStart.push({ fiber: fiber, at: performance.now(), kind: kind });
      },
      stop: function () {
        var item = effectStart.pop();
        if (!item || !state.recording) return;
        var name = (nameOf(item.fiber) || "(host)") + " " + kind;
        var entry = state.effects.get(name) || { ms: 0, renders: 0 };
        entry.ms += performance.now() - item.at;
        entry.renders += 1;
        state.effects.set(name, entry);
      },
    };
  }
  var render = phase("render");
  var commit = phase("commit");
  var layout = phase("layoutEffects");
  var passive = phase("passiveEffects");
  var layoutMount = effect("layout effect");
  var layoutUnmount = effect("layout cleanup");
  var passiveMount = effect("effect");
  var passiveUnmount = effect("effect cleanup");
  var profilingHooks = {
    markRenderStarted: render.start,
    markRenderStopped: render.stop,
    markRenderYielded: render.stop,
    markCommitStarted: commit.start,
    markCommitStopped: commit.stop,
    markLayoutEffectsStarted: layout.start,
    markLayoutEffectsStopped: layout.stop,
    markPassiveEffectsStarted: passive.start,
    markPassiveEffectsStopped: passive.stop,
    markComponentLayoutEffectMountStarted: layoutMount.start,
    markComponentLayoutEffectMountStopped: layoutMount.stop,
    markComponentLayoutEffectUnmountStarted: layoutUnmount.start,
    markComponentLayoutEffectUnmountStopped: layoutUnmount.stop,
    markComponentPassiveEffectMountStarted: passiveMount.start,
    markComponentPassiveEffectMountStopped: passiveMount.stop,
    markComponentPassiveEffectUnmountStarted: passiveUnmount.start,
    markComponentPassiveEffectUnmountStopped: passiveUnmount.stop,
    markComponentRenderStarted: function () {},
    markComponentRenderStopped: function () {},
    markComponentErrored: function () {},
    markComponentSuspended: function () {},
    markStateUpdateScheduled: function () {},
    markForceUpdateScheduled: function () {},
    markRenderScheduled: function () {},
  };
  var nextId = 1;
  window.__REACT_DEVTOOLS_GLOBAL_HOOK__ = {
    supportsFiber: true,
    isDisabled: false,
    renderers: new Map(),
    inject: function (internals) {
      if (internals && typeof internals.injectProfilingHooks === "function")
        internals.injectProfilingHooks(profilingHooks);
      return nextId++;
    },
    checkDCE: function () {},
    onScheduleFiberRoot: function () {},
    onCommitFiberUnmount: function () {},
    // Timestamps: a commit's DOM changes and layout effects are done when
    // onCommitFiberRoot runs; its passive effects when onPostCommitFiberRoot does.
    onPostCommitFiberRoot: function () {
      if (state.recording)
        state.marks.push({ at: performance.now(), kind: "effects" });
    },
    onCommitFiberRoot: function (_id, root) {
      if (!state.recording) return;
      state.marks.push({ at: performance.now(), kind: "commit" });
      state.commits += 1;
      var begin = performance.now();
      collect(root.current, state.recording);
      // Our own accounting is not the app's time.
      state.overheadMs += performance.now() - begin;
    },
  };
  window.__AVEN_PERF_REACT__ = state;
})();
