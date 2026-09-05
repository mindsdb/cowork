import { host } from '../../platform/host';

/**
 * Capabilities are server-owned: hosted responses without them fail closed; desktop retains legacy
 * local-owner fallback.
 */
export function canUseSharedResource(resource, capability, isWeb = host.isWeb) {
  const decision = resource?.capabilities?.[capability];
  if (typeof decision === 'boolean') return decision;
  return !isWeb;
}

/**
 * Cloud reserves only general; default is a user project there. Desktop retains both legacy
 * reserved names.
 */
export function isReservedProjectName(name, isWeb = host.isWeb) {
  return name === 'general' || (!isWeb && name === 'default');
}

/** Stands in for an actor the server identified but deliberately did not name. */
export const OTHER_ACTOR_LABEL = 'Another member';

/** Stands in for an actor the server could not identify at all. */
export const UNKNOWN_ACTOR_LABEL = 'Unknown';

/**
 * Only the viewer's email is returned; other actors have opaque ids with no directory lookup, so
 * display the anonymous label.
 */
export function actorLabel(actor) {
  if (!actor) return '';
  if (typeof actor === 'string') return actor;
  if (actor.email) return actor.email;
  if (actor.userId || actor.user_id) return OTHER_ACTOR_LABEL;
  return UNKNOWN_ACTOR_LABEL;
}

/**
 * Prefer server camelCase aliases; retain snake_case fallback for payloads serialized without
 * aliases.
 */
export function sharedResourceAttribution(resource) {
  const attribution = resource?.attribution;
  if (!attribution) return null;
  const createdBy = actorLabel(attribution.createdBy ?? attribution.created_by);
  const lastModifiedBy = actorLabel(
    attribution.lastModifiedBy ?? attribution.last_modified_by,
  );
  const lastModifiedAt = attribution.lastModifiedAt || attribution.last_modified_at || null;
  if (!createdBy && !lastModifiedBy) return null;
  return { createdBy, lastModifiedBy, lastModifiedAt };
}
