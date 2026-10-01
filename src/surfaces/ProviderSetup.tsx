import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { HarnessIcon } from "../chrome/HarnessIcon";
import { Check, ChevronRight, Loader, RefreshCw } from "../chrome/icons";
import { Modal } from "../chrome/Modal";
import { openInAppUrl } from "../lib/inAppLinks";
import { IS_MAC, IS_WIN } from "../lib/platform";
import { recordHarnessAvailability } from "../lib/harness/availability";
import { refreshHarnessCatalogs } from "../lib/harness/registry";
import {
  loadProviderSetup,
  saveProviderSetup,
  type ProviderSetupCheck,
  type ProviderSetupPlan,
} from "../lib/providerSetup";
import { HARNESSES, HARNESS_TITLE, type HarnessId } from "../lib/session";
import "./ProviderSetup.css";

const TerminalView = lazy(() =>
  import("./TerminalView").then((module) => ({ default: module.TerminalView })),
);
const DESCRIPTIONS: Record<HarnessId, string> = {
  claude: "Connect your Claude Code account.",
  codex: "Connect with ChatGPT or your OpenAI API account.",
  cursor: "Use the Cursor agent CLI.",
  grok: "Connect Grok Build from xAI.",
  opencode: "Connect the models you use in OpenCode.",
  pi: "Use your Pi provider configuration.",
  omp: "Use your oh-my-pi provider configuration.",
  fx: "Connect your fx CLI configuration.",
};
const LABELS: Record<ProviderSetupCheck["status"], string> = {
  missing: "Not installed",
  installed: "Installed · connection not checked",
  signInRequired: "Sign-in needed",
  ready: "Signed in",
  error: "Needs attention",
};
type Props = {
  onDone?: (harness?: HarnessId) => void;
  onChooseFolder?: () => void;
};
type TerminalRun = { id: string; plan: ProviderSetupPlan };

/** Selecting a provider never installs it, signs in, or changes picker preferences. */
export function ProviderSetup({ onDone, onChooseFolder }: Props) {
  const [selected, setSelected] = useState(() => loadProviderSetup().selected);
  const [step, setStep] = useState<"choose" | "connect" | "finish">("choose");
  const [checks, setChecks] = useState<
    Partial<Record<HarnessId, ProviderSetupCheck>>
  >({});
  const [pending, setPending] = useState<Partial<Record<HarnessId, boolean>>>(
    {},
  );
  const [tested, setTested] = useState<Partial<Record<HarnessId, boolean>>>({});
  const [plan, setPlan] = useState<ProviderSetupPlan | null>(null);
  const [terminal, setTerminal] = useState<TerminalRun | null>(null);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(true);
  const mounted = useRef(false);
  const requests = useRef(new Map<HarnessId, number>());
  const checkingProviders = useRef(new Set<HarnessId>());
  const actionRequest = useRef(0);
  const actionPending = useRef(false);
  const [preparing, setPreparing] = useState(false);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      actionRequest.current += 1;
    };
  }, []);

  const persist = (
    choices: HarnessId[],
    finished = loadProviderSetup().finished,
  ) => {
    setSaved(saveProviderSetup({ selected: choices, finished }));
  };
  const choose = (harness: HarnessId) => {
    const next = selected.includes(harness)
      ? selected.filter((id) => id !== harness)
      : [...selected, harness];
    setSelected(next);
    persist(next);
  };
  const check = async (harness: HarnessId, verify = false) => {
    // One request per provider; a late readiness check cannot overwrite a newer test.
    if (checkingProviders.current.has(harness)) return;
    checkingProviders.current.add(harness);
    const request = (requests.current.get(harness) ?? 0) + 1;
    requests.current.set(harness, request);
    setPending((previous) => ({ ...previous, [harness]: true }));
    setError("");
    if (!verify) setTested((previous) => ({ ...previous, [harness]: false }));
    try {
      const result = await invoke<ProviderSetupCheck>(
        verify ? "provider_setup_verify" : "provider_setup_check",
        { harness },
      );
      if (!mounted.current || requests.current.get(harness) !== request) return;
      setChecks((previous) => ({ ...previous, [harness]: result }));
      if (result.status === "missing")
        recordHarnessAvailability(harness, false);
      else if (result.status !== "error" || result.version) {
        recordHarnessAvailability(harness, true);
      }
      if (result.status === "ready" && !verify) {
        // Connecting from Settings must also make the chosen provider's model
        // picker usable. Model discovery is read-only and never installs tools.
        void refreshHarnessCatalogs([harness], { force: true }).catch(
          () => undefined,
        );
      }
      setTested((previous) => ({
        ...previous,
        [harness]: verify && result.status === "ready",
      }));
    } catch {
      if (!mounted.current || requests.current.get(harness) !== request) return;
      setChecks((previous) => ({
        ...previous,
        [harness]: {
          harness,
          platform: IS_WIN ? "windows" : IS_MAC ? "macos" : "linux",
          status: "error",
          version: null,
          message:
            "Aven couldn’t check this provider. Try again, or reopen Aven after installing the CLI.",
        },
      }));
    } finally {
      checkingProviders.current.delete(harness);
      if (mounted.current && requests.current.get(harness) === request) {
        setPending((previous) => ({ ...previous, [harness]: false }));
      }
    }
  };
  const connect = () => {
    setStep("connect");
    setError("");
    for (const harness of selected) void check(harness);
  };
  const prepare = async (
    harness: HarnessId,
    action: ProviderSetupPlan["action"],
  ) => {
    if (actionPending.current || terminal) return;
    actionPending.current = true;
    const request = ++actionRequest.current;
    setPreparing(true);
    setError("");
    setPlan(null);
    try {
      const next = await invoke<ProviderSetupPlan>("provider_setup_plan", {
        harness,
        action,
      });
      if (mounted.current && actionRequest.current === request) setPlan(next);
    } catch {
      if (mounted.current && actionRequest.current === request) {
        setError(
          "Aven couldn’t prepare this step. Check the provider again and retry.",
        );
      }
    } finally {
      if (mounted.current && actionRequest.current === request) {
        actionPending.current = false;
        setPreparing(false);
      }
    }
  };
  const run = () => {
    if (!plan?.command || terminal || actionPending.current) return;
    const id = `aven-provider-setup-${crypto.randomUUID()}`;
    setTerminal({ id, plan });
    setTested((previous) => ({ ...previous, [plan.harness]: false }));
    setPlan(null);
  };
  const closeTerminal = () => {
    const current = terminal;
    if (!current) return;
    setTerminal(null);
    if (mounted.current) void check(current.plan.harness);
  };
  const finish = () => {
    persist(selected, true);
    setStep("finish");
  };
  const skip = () => {
    persist(selected, true);
    onDone?.();
  };
  const verified = selected.filter(
    (id) => tested[id] && checks[id]?.status === "ready",
  );
  const ready = selected.filter((id) => checks[id]?.status === "ready");
  const usable = selected.filter((id) =>
    ["ready", "installed"].includes(checks[id]?.status ?? ""),
  );
  const busy = Object.values(pending).some(Boolean) || preparing || !!terminal;

  return (
    <div className="provider-setup">
      <div className="provider-setup-progress" aria-label="Setup progress">
        {["Choose", "Connect", "Start"].map((label, index) => (
          <span
            key={label}
            aria-current={
              index === ["choose", "connect", "finish"].indexOf(step)
                ? "step"
                : undefined
            }
          >
            <span className="provider-setup-step-number">{index + 1}</span>
            {label}
          </span>
        ))}
        <small>{IS_WIN ? "Windows" : IS_MAC ? "macOS" : "Linux"}</small>
      </div>
      {!saved ? (
        <p role="alert" className="provider-setup-error">
          Your setup choices couldn’t be saved on this device.
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="provider-setup-error">
          {error}
        </p>
      ) : null}
      {step === "choose" ? (
        <>
          <div className="provider-setup-lead">
            <h3>Which providers would you like to use?</h3>
            <p>
              Choose one or more. You can add others later. Nothing is installed
              until you choose to run an installation.
            </p>
          </div>
          <div className="provider-setup-choices" aria-label="Choose providers">
            {HARNESSES.slice(0, 2).map((harness) => (
              <ProviderChoice
                key={harness}
                harness={harness}
                selected={selected.includes(harness)}
                onChoose={choose}
              />
            ))}
            <details
              className="provider-setup-more"
              open={
                selected.some((id) => !["claude", "codex"].includes(id)) ||
                undefined
              }
            >
              <summary>
                More providers <ChevronRight className="size-3.5" aria-hidden />
              </summary>
              <div>
                {HARNESSES.slice(2).map((harness) => (
                  <ProviderChoice
                    key={harness}
                    harness={harness}
                    selected={selected.includes(harness)}
                    onChoose={choose}
                  />
                ))}
              </div>
            </details>
          </div>
          <p className="provider-setup-note">
            Aven connects to your provider’s CLI. Provider accounts and usage
            are managed by that provider.
          </p>
          <footer className="provider-setup-footer">
            {onDone ? (
              <button className="provider-setup-secondary" onClick={skip}>
                Set up later
              </button>
            ) : (
              <span />
            )}
            <button
              className="provider-setup-primary"
              disabled={!selected.length}
              onClick={connect}
            >
              Continue <ChevronRight className="size-3.5" aria-hidden />
            </button>
          </footer>
        </>
      ) : null}
      {step === "connect" ? (
        <>
          <div className="provider-setup-lead">
            <h3>Connect your selected providers</h3>
            <p>
              We’ll check only the providers you chose. Installation, sign-in
              and a test message each start when you ask.
            </p>
          </div>
          <div className="provider-setup-checks">
            {selected.map((harness) => {
              const result = checks[harness];
              const checking = pending[harness];
              const guided = harness === "claude" || harness === "codex";
              const supportsTest = harness === "claude";
              return (
                <section
                  className="provider-setup-check"
                  key={harness}
                  aria-label={`${HARNESS_TITLE[harness]} setup`}
                >
                  <div className="provider-setup-check-heading">
                    <HarnessIcon harness={harness} className="size-6" />
                    <div>
                      <h4>{HARNESS_TITLE[harness]}</h4>
                      <p
                        className="provider-setup-status"
                        data-status={
                          tested[harness] ? "tested" : result?.status
                        }
                        role="status"
                      >
                        {checking ? (
                          <>
                            <Loader
                              className="size-3 animate-spin"
                              aria-hidden
                            />
                            Checking…
                          </>
                        ) : tested[harness] ? (
                          <>
                            <Check className="size-3" aria-hidden />
                            Connection tested
                          </>
                        ) : result ? (
                          LABELS[result.status]
                        ) : (
                          "Not checked"
                        )}
                      </p>
                    </div>
                    {result?.version ? <small>{result.version}</small> : null}
                  </div>
                  {result && !checking ? (
                    <p className="provider-setup-message">{result.message}</p>
                  ) : null}
                  <div className="provider-setup-actions">
                    {result?.status === "missing" ? (
                      <button
                        disabled={busy}
                        className="provider-setup-primary"
                        onClick={() => void prepare(harness, "install")}
                      >
                        {guided ? "Install CLI" : "Installation guide"}
                      </button>
                    ) : null}
                    {result &&
                    ["signInRequired", "installed", "error"].includes(
                      result.status,
                    ) ? (
                      <button
                        disabled={busy}
                        className="provider-setup-secondary"
                        onClick={() => void prepare(harness, "signIn")}
                      >
                        {guided ? "Sign in" : "Connection guide"}
                      </button>
                    ) : null}
                    {result?.status === "ready" &&
                    !tested[harness] &&
                    supportsTest ? (
                      <button
                        disabled={busy}
                        className="provider-setup-primary"
                        onClick={() => void check(harness, true)}
                      >
                        Send test message
                      </button>
                    ) : null}
                    <button
                      className="provider-setup-secondary"
                      disabled={busy}
                      aria-label={`Check ${HARNESS_TITLE[harness]} again`}
                      onClick={() => void check(harness)}
                    >
                      <RefreshCw className="size-3" aria-hidden />
                      Check again
                    </button>
                  </div>
                  {result?.status === "ready" &&
                  !tested[harness] &&
                  supportsTest ? (
                    <p className="provider-setup-note">
                      Sends a short message without tools or project files. Uses
                      your provider’s normal usage allowance.
                    </p>
                  ) : null}
                  {result?.status === "ready" && !supportsTest ? (
                    <p className="provider-setup-note">
                      Start your first task in Aven to confirm this account can
                      send a message.
                    </p>
                  ) : null}
                </section>
              );
            })}
          </div>
          {plan ? (
            <section
              className="provider-setup-plan"
              aria-label="Review setup action"
            >
              <h4>
                {plan.action === "install" ? "Install" : "Sign in to"}{" "}
                {HARNESS_TITLE[plan.harness]}
              </h4>
              <p>{plan.message}</p>
              {plan.command ? (
                <details>
                  <summary>Show command</summary>
                  <pre>{plan.displayCommand ?? plan.command}</pre>
                </details>
              ) : null}
              <div className="provider-setup-actions">
                {plan.command ? (
                  <button className="provider-setup-primary" onClick={run}>
                    {plan.action === "install"
                      ? "Run installation"
                      : "Start sign-in"}
                  </button>
                ) : null}
                <button
                  className="provider-setup-secondary"
                  onClick={() =>
                    void openInAppUrl(plan.docsUrl).catch(() =>
                      setError(
                        "The guide couldn’t be opened. Try again after the workspace finishes opening.",
                      ),
                    )
                  }
                >
                  Official guide
                </button>
                <button
                  className="provider-setup-secondary"
                  onClick={() => setPlan(null)}
                >
                  Cancel
                </button>
              </div>
            </section>
          ) : null}
          {terminal ? (
            <section
              className="provider-setup-terminal-panel"
              aria-label={`${HARNESS_TITLE[terminal.plan.harness]} setup terminal`}
            >
              <div className="provider-setup-terminal-heading">
                <h4>
                  {HARNESS_TITLE[terminal.plan.harness]} ·{" "}
                  {terminal.plan.action === "install"
                    ? "Installation"
                    : "Sign-in"}
                </h4>
                <button
                  className="provider-setup-secondary"
                  onClick={() => void closeTerminal()}
                >
                  Close & check
                </button>
              </div>
              <p>
                Follow the prompts below. Closing this terminal stops any
                unfinished setup command.
              </p>
              <div className="provider-setup-terminal">
                <Suspense fallback={<p>Opening terminal…</p>}>
                  <TerminalView
                    id={terminal.id}
                    cwd="~"
                    active
                    presented
                    ephemeral
                    setupCommand={terminal.plan.command ?? undefined}
                  />
                </Suspense>
              </div>
            </section>
          ) : null}
          <p className="provider-setup-note">
            Installed but still not found? Reopen Aven after installation so it
            can see changes to your command search path (PATH).
          </p>
          <footer className="provider-setup-footer">
            <button
              className="provider-setup-secondary"
              disabled={busy}
              onClick={() => {
                setPlan(null);
                setStep("choose");
              }}
            >
              Back
            </button>
            <button
              className="provider-setup-primary"
              disabled={busy}
              onClick={finish}
            >
              {ready.length ? "Continue" : "Continue setup later"}
              <ChevronRight className="size-3.5" aria-hidden />
            </button>
          </footer>
        </>
      ) : null}
      {step === "finish" ? (
        <>
          <div className="provider-setup-finish-mark" aria-hidden>
            <Check className="size-7" />
          </div>
          <div className="provider-setup-lead">
            <h3>
              {verified.length
                ? "You’re ready for your first task"
                : ready.length
                  ? "Your provider is connected"
                  : "Your choices are saved"}
            </h3>
            <p>
              {verified.length
                ? `${verified.map((id) => HARNESS_TITLE[id]).join(" and ")} responded to a test message.`
                : ready.length
                  ? "Sign-in is confirmed. Start your first task to check the connection."
                  : "You can finish connecting your providers whenever you’re ready."}
            </p>
          </div>
          <p className="provider-setup-note">
            Return to Settings → Provider setup to add a provider or
            troubleshoot a connection.
          </p>
          <footer className="provider-setup-footer">
            <button
              className="provider-setup-secondary"
              onClick={() => setStep("connect")}
            >
              Back
            </button>
            <div className="provider-setup-actions">
              {onChooseFolder && ready.length ? (
                <button
                  className="provider-setup-secondary"
                  onClick={() => {
                    onDone?.(usable[0]);
                    onChooseFolder();
                  }}
                >
                  Choose a folder
                </button>
              ) : null}
              {onDone ? (
                <button
                  className="provider-setup-primary"
                  onClick={() => onDone(usable[0])}
                >
                  Open Aven
                </button>
              ) : (
                <button
                  className="provider-setup-primary"
                  onClick={() => setStep("choose")}
                >
                  Choose providers
                </button>
              )}
            </div>
          </footer>
        </>
      ) : null}
    </div>
  );
}

function ProviderChoice({
  harness,
  selected,
  onChoose,
}: {
  harness: HarnessId;
  selected: boolean;
  onChoose: (harness: HarnessId) => void;
}) {
  return (
    <button
      type="button"
      className="provider-setup-choice"
      role="checkbox"
      aria-checked={selected}
      aria-label={`Connect ${HARNESS_TITLE[harness]}`}
      onClick={() => onChoose(harness)}
    >
      <span className="provider-setup-provider-mark">
        <HarnessIcon harness={harness} className="size-7" />
      </span>
      <span className="provider-setup-choice-copy">
        <strong>{HARNESS_TITLE[harness]}</strong>
        <span>{DESCRIPTIONS[harness]}</span>
      </span>
      <span className="provider-setup-checkbox" aria-hidden>
        {selected ? <Check className="size-3" /> : null}
      </span>
    </button>
  );
}

export function ProviderSetupDialog({
  onDone,
  onChooseFolder,
}: Props & { onDone: (harness?: HarnessId) => void }) {
  const dismiss = () => {
    saveProviderSetup({ ...loadProviderSetup(), finished: true });
    onDone();
  };
  return (
    <Modal
      title="Welcome to Aven"
      description="Connect the providers you want to work with."
      className="provider-setup-modal"
      onClose={dismiss}
    >
      <ProviderSetup onDone={onDone} onChooseFolder={onChooseFolder} />
    </Modal>
  );
}
