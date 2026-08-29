import { host } from '../../platform/host';

/**
 * Shared-resource capabilities are server decisions. Hosted Cowork fails
 * closed when a response does not carry them; desktop keeps its historical
 * local-owner behaviour so older loopback servers remain usable.
 */
export function canUseSharedResource(resource, capability, isWeb = host.isWeb) {
  const decision = resource?.capabilities?.[capability];
  if (typeof decision === 'boolean') return decision;
  return !isWeb;
}

/**
 * Desktop historically treats both default project names as system-owned.
 * Cowork Cloud has one immutable project, `general`; a hosted project named
 * `default` is an ordinary user-created project whose server capabilities
 * remain authoritative.
 */
export function isReservedProjectName(name, isWeb = host.isWeb) {
  return name === 'general' || (!isWeb && name === 'default');
}

export function actorLabel(actor) {
  if (!actor) return '';
  if (typeof actor === 'string') return actor;
  return actor.email || actor.userId || actor.user_id || '';
}

export function sharedResourceAttribution(resource) {
  const attribution = resource?.attribution;
  if (!attribution) return null;
  const createdBy = actorLabel(attribution.createdBy);
  const lastModifiedBy = actorLabel(attribution.lastModifiedBy);
  const lastModifiedAt = attribution.lastModifiedAt || null;
  if (!createdBy && !lastModifiedBy) return null;
  return { createdBy, lastModifiedBy, lastModifiedAt };
}
