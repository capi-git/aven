/** Floating composers contribute their last edit before an owner snapshot. */
const flushers = new Set<() => Promise<void>>();

export function registerWorkspaceDraftFlusher(flush: () => Promise<void>) {
  flushers.add(flush);
  return () => {
    flushers.delete(flush);
  };
}

export async function flushWorkspaceDrafts(): Promise<void> {
  await Promise.all([...flushers].map((flush) => flush()));
}
