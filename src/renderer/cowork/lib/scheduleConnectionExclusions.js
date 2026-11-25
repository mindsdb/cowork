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

export function matchesScheduleExclusion(exclusion, connector) {
  if (exclusion.datasource_id != null) {
    return exclusion.engine === connector.engine && exclusion.datasource_id === connector.datasourceId;
  }
  return connectionMuteKey(exclusion.engine, exclusion.name) === connectionMuteKey(connector.engine, connector.name);
}

export function toggleScheduleExclusion(exclusions, connector, allowed) {
  const remaining = exclusions.filter((entry) => !matchesScheduleExclusion(entry, connector));
  return allowed ? remaining : [...remaining, ...scheduleConnectionExclusions([connector])];
}
