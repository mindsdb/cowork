// Hold the loading screen through sidecar startup and the boot update poll to avoid flashing an
// offline chat.

/** Wait for every barrier, including failures. Each underlying operation supplies its own timeout. */
export function awaitBootSettled(barriers: Array<Promise<unknown>>): Promise<void> {
  return Promise.allSettled(barriers).then(() => undefined);
}
