/**
 * Wrap an async job so overlapping calls share one run (a reconnect event, the
 * app coming to the foreground and a "Sync now" tap can all fire together).
 * Without it two loops could upload the same queued entry at once.
 */
export function singleFlight<T>(job: () => Promise<T>): () => Promise<T> {
  let running: Promise<T> | null = null;
  return () => (running ??= job().finally(() => { running = null; }));
}
