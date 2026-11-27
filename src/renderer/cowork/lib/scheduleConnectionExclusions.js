import { connectionMuteKey } from './connectionMutes';

export function scheduleConnectionExclusions(list) {
  if (!Array.isArray(list)) return [];
  return list.flatMap((item) => {
    const engine = String(item?.engine || '').trim();
    const name = String(item?.name || '').trim();
    if (!engine || !name) return [];
    const id = item.datasource_id ?? item.datasourceId;
    return [{ engine, name, ...(Number.isSafeInteger(id) && id > 0 ? { datasource_id: id } : {}) }];
  });
}

// Whether a task's exclusion leaves `connector` out, as the server decides
// it for a run. A database is matched by its id, which survives a rename.
// Once no listed connection (`connectors`) holds that id, the database was
// deleted, and the exclusion falls back to its name: one added again under
// that name stays left out until the user gives it back.
export function matchesScheduleExclusion(exclusion, connector, connectors = []) {
  const sameName = connectionMuteKey(exclusion.engine, exclusion.name) === connectionMuteKey(connector.engine, connector.name);
  if (exclusion.datasource_id == null) return sameName;
  if (exclusion.engine !== connector.engine) return false;
  if (exclusion.datasource_id === connector.datasourceId) return true;
  const listed = connectors.some((c) => c.engine === exclusion.engine && c.datasourceId === exclusion.datasource_id);
  return !listed && sameName;
}

export function toggleScheduleExclusion(exclusions, connector, allowed, connectors = []) {
  const remaining = exclusions.filter((entry) => !matchesScheduleExclusion(entry, connector, connectors));
  return allowed ? remaining : [...remaining, ...scheduleConnectionExclusions([connector])];
}
