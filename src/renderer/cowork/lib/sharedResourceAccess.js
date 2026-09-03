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

/** Stands in for an actor the server identified but deliberately did not name. */
export const OTHER_ACTOR_LABEL = 'Another member';

/** Stands in for an actor the server could not identify at all. */
export const UNKNOWN_ACTOR_LABEL = 'Unknown';

/**
 * The server no longer stores email addresses, and returns one only when the
 * actor is the viewer themselves. Everyone else arrives as a bare user id,
 * which is a UUID no member can read and which we have no directory to
 * resolve, so it never reaches the screen.
 */
export function actorLabel(actor) {
  if (!actor) return '';
  if (typeof actor === 'string') return actor;
  if (actor.email) return actor.email;
  if (actor.userId || actor.user_id) return OTHER_ACTOR_LABEL;
  return UNKNOWN_ACTOR_LABEL;
}

/**
 * cowork-server serializes attribution through camelCase aliases, so camelCase
 * is the shape on the wire. Read the snake_case spelling as a fallback, the
 * same hedge the actor branch already makes, so a payload dumped without
 * aliases still resolves instead of silently losing the creator.
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
