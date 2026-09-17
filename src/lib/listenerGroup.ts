/** Roll back partial registrations, including successes arriving after failure
 * or unmount. Attaches a rejection handler to every registration immediately. */
export function listenerGroup(registrations: Promise<() => void>[]) {
  let disposed = false;
  const installed = new Set<() => void>();
  const dispose = () => {
    disposed = true;
    for (const unlisten of installed) unlisten();
    installed.clear();
  };
  const ready = Promise.all(
    registrations.map(async (registration) => {
      const unlisten = await registration;
      if (disposed) unlisten();
      else installed.add(unlisten);
    }),
  )
    .then(() => undefined)
    .catch((error: unknown) => {
      dispose();
      throw error;
    });
  return { ready, dispose };
}
