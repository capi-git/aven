import { registerBuiltinHarnesses } from "./harness/register";
import { listHarnesses, registerHarness } from "./harness/registry";
import type { NativeCommand } from "./harness/nativeCommands";
import { setHarnessModels, type AgentModel } from "./models";
import { HARNESSES, type HarnessId } from "./session";

let registered = false;
let catalogVersion: number | undefined;
let commandKey = "";
let commands: NativeCommand[] = [];
const listeners = new Set<{
  harness: HarnessId;
  receive: (commands: NativeCommand[]) => void;
}>();

/** View metadata only. No CLI probing, child bridge or session binding here. */
export function prepareSessionPipViewMetadata(state: {
  catalog?: AgentModel[];
  catalogVersion?: number;
  nativeCommands?: NativeCommand[];
}) {
  if (!registered) {
    registerBuiltinHarnesses();
    for (const adapter of listHarnesses()) {
      registerHarness({
        ...adapter,
        // A picker in another webview must not spawn a competing catalog probe.
        refreshCatalog: undefined,
        commands: adapter.commands
          ? {
              rawSlashCommands: adapter.commands.rawSlashCommands,
              discover: async () =>
                commands.filter((command) => command.source === adapter.id),
              subscribe: (_context, receive) => {
                const listener = { harness: adapter.id, receive };
                listeners.add(listener);
                receive(
                  commands.filter((command) => command.source === adapter.id),
                );
                return () => {
                  listeners.delete(listener);
                };
              },
            }
          : undefined,
      });
    }
    registered = true;
  }
  if (Array.isArray(state.catalog) && catalogVersion !== state.catalogVersion) {
    for (const harness of HARNESSES) {
      const models = state.catalog.filter((model) => model.harness === harness);
      if (models.length) setHarnessModels(harness, models);
    }
    catalogVersion = state.catalogVersion;
  }
  const nextCommands = state.nativeCommands ?? [];
  const nextKey = JSON.stringify(nextCommands);
  if (nextKey !== commandKey) {
    commands = nextCommands;
    commandKey = nextKey;
    for (const listener of listeners)
      listener.receive(
        commands.filter((command) => command.source === listener.harness),
      );
  }
}
