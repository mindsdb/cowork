// A chat's muted connections, as the composer edits them and a send carries them.

/** Trims entries and drops any without both an engine and a name. */
export function normalizeComposerDisabledConnections(list) {
  if (!Array.isArray(list)) return [];
  return list
    .map((d) => ({
      engine: String(d.engine || '').trim(),
      name: String(d.name || '').trim(),
    }))
    .filter((d) => d.engine && d.name);
}

/** Identity of a connection in a mute list; the engine is case-insensitive. */
export function connectionMuteKey(engine, name) {
  return `${String(engine || '').trim().toLowerCase()}\t${String(name || '').trim()}`;
}

/**
 * Applies one composer mute toggle to a mute list. Returns `list` itself when
 * nothing changes, so a state setter can skip the re-render.
 */
export function toggleConnectionMute(list, connector, useInChat) {
  const engine = String(connector?.engine || '').trim();
  const name = String(connector?.name || '').trim();
  if (!engine || !name) return list;
  const key = connectionMuteKey(engine, name);
  const cur = normalizeComposerDisabledConnections(list);
  const muted = cur.some((x) => connectionMuteKey(x.engine, x.name) === key);
  if (muted !== useInChat) return Array.isArray(list) ? list : cur;
  return useInChat
    ? cur.filter((x) => connectionMuteKey(x.engine, x.name) !== key)
    : [...cur, { engine, name }];
}
