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

/**
 * Applies one composer mute toggle to a mute list. Returns `list` itself when
 * nothing changes, so a state setter can skip the re-render.
 */
export function toggleConnectionMute(list, connector, useInChat) {
  const engine = String(connector?.engine || '').trim();
  const name = String(connector?.name || '').trim();
  if (!engine || !name) return list;
  const pk = (x) => `${x.engine.toLowerCase()}\t${x.name}`;
  const ckey = pk({ engine, name });
  const cur = normalizeComposerDisabledConnections(list);
  const next = useInChat
    ? cur.filter((x) => pk(x) !== ckey)
    : (cur.some((x) => pk(x) === ckey) ? cur : [...cur, { engine, name }]);
  const sig = (arr) => [...arr.map(pk)].sort().join('|');
  return sig(cur) === sig(next) && Array.isArray(list) ? list : next;
}
