/*
 * The "whose is this" marker with the owner's name in it (ENG-4455).
 *
 * In MindsHub mode an artifact a colleague owns carries `ownerUserId` in its
 * capabilities. Its name comes from MindsHub through useKnownPeople, the same
 * lookup the Share panel names recipients with, so nothing new is asked of
 * the server. Until the name is in, and when MindsHub can't name the id, the
 * marker says "Another member", as it always has.
 *
 * A list names its owners in one lookup: <ArtifactOwnerNamesProvider> takes
 * every capabilities object it shows and asks for their owners at once, so a
 * grid of fifty cards by three colleagues is one request, not fifty. A marker
 * outside a provider (the viewer opened from a chat) asks for its own owner.
 */

import { createContext, useContext, useMemo } from 'react';
import { artifactAuthorship, artifactOwnerUserId } from '../lib/artifactAuthorship';
import { useKnownPeople } from './useOrgSharing';

const NONE = Object.freeze([]);
const OwnerNamesContext = createContext(null);

/* A person useKnownPeople answered for, as a name; null while it is still
   being asked, and when MindsHub couldn't or didn't name them. */
function personName(person) {
  if (!person || person.pending || person.failed) return null;
  return person.name || person.email || null;
}

/** The owner ids among `capabilitiesList`, each once. */
export function artifactOwnerIds(capabilitiesList) {
  const ids = new Set();
  for (const caps of capabilitiesList || NONE) {
    const id = artifactOwnerUserId(caps);
    if (id) ids.add(id);
  }
  return [...ids];
}

/**
 * Names the owners of `capabilitiesList` (one capabilities object per
 * artifact shown) for every useArtifactAuthorship below it, in one lookup.
 */
export function ArtifactOwnerNamesProvider({ capabilitiesList, children }) {
  const { people } = useKnownPeople(artifactOwnerIds(capabilitiesList));
  const names = useMemo(() => {
    const map = new Map();
    for (const person of people) map.set(person.id, personName(person));
    return map;
  }, [people]);
  return <OwnerNamesContext.Provider value={names}>{children}</OwnerNamesContext.Provider>;
}

/** Owner names for many artifacts at once, outside a provider: `(caps) =>
    artifactAuthorship(caps, { ownerName })`. */
export function useArtifactAuthorships(capabilitiesList) {
  const ids = artifactOwnerIds(capabilitiesList);
  const { people } = useKnownPeople(ids);
  const byId = new Map(people.map((person) => [person.id, personName(person)]));
  return (caps) => artifactAuthorship(caps, { ownerName: byId.get(artifactOwnerUserId(caps)) ?? null });
}

/**
 * artifactAuthorship() with the owner named: from the nearest provider's
 * lookup when it has asked about this owner, or else from one of its own.
 */
export function useArtifactAuthorship(capabilities) {
  const names = useContext(OwnerNamesContext);
  const id = artifactOwnerUserId(capabilities);
  const fromProvider = !!id && !!names && names.has(id);
  const own = useKnownPeople(id && !fromProvider ? [id] : NONE);
  const ownerName = !id ? null : fromProvider ? names.get(id) : personName(own.people[0]);
  return artifactAuthorship(capabilities, { ownerName });
}
