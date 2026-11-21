// Who each restricted artifact on a list reaches, in MindsHub mode (ENG-4560).
//
// A card there doesn't say: MindsHub's sharing rule is the one record of a
// restricted artifact's audience, so the server sends its audience fields as
// null (readArtifactAudience's "unknown"). A card only learned it when
// something else filled it in (opening Share), so the Artifacts page filed
// the same artifact under Yours one time and Everyone at the org the next,
// and its badge could only say "Restricted".
//
// This reads the audience of every published restricted card the list shows
// through the read-only audience route (GET .../audience, open to anyone who
// may preview the artifact, never the password), a few at a time, and hands
// back the list with each card's audience filled in. Answers are kept for the
// session, keyed by artifact and its publish, so the page groups the same way
// on every visit; a card is read again once its publish changes. A caller
// outside the artifact's org (`names: false`) is told only how it's shared,
// which says nothing about who: such a card stays unknown.

import { useEffect, useMemo, useState } from 'react';
import { loadArtifactAudience } from '../lib/artifactWorkspaceApi';
import { readArtifactAudience } from '../lib/sharingContract';

const STORAGE_KEY = 'cowork.artifactAudiences.v1';
const CONCURRENCY = 4;

const memory = new Map();
let loaded = false;

function keyOf(artifact) {
  const id = artifact?.id || artifact?.path;
  if (!id || !artifact?.publishedUrl) return null;
  return `${id}|${artifact.publishedUrl}|${artifact.mtime || ''}`;
}

function restore() {
  if (loaded) return;
  loaded = true;
  try {
    const saved = JSON.parse(window.sessionStorage.getItem(STORAGE_KEY) || '{}');
    for (const [key, value] of Object.entries(saved)) if (value && typeof value === 'object') memory.set(key, value);
  } catch { /* storage unavailable: read again */ }
}

function persist() {
  try {
    window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(Object.fromEntries(memory)));
  } catch { /* storage unavailable: kept in memory */ }
}

/** Whether a card needs its audience read: published, restricted, unknown. */
export function needsAudience(artifact) {
  return !!keyOf(artifact) && artifact.accessMode === 'restricted' && readArtifactAudience(artifact) === null;
}

/* The audience fields a card carries, from the route's answer; null when it
   names nobody (a caller outside the org). */
function cardFields(answer) {
  if (!answer || answer.names === false) return null;
  return {
    orgAllowed: answer.orgAllowed === true,
    allowedTeamIds: Array.isArray(answer.allowedTeamIds) ? answer.allowedTeamIds : [],
    allowedUserIds: Array.isArray(answer.allowedUserIds) ? answer.allowedUserIds : [],
    accessEmails: Array.isArray(answer.accessEmails) ? answer.accessEmails : [],
    ownerOnly: answer.ownerOnly === true,
  };
}

/** For tests: forget every answer. */
export function resetArtifactAudiences() {
  memory.clear();
  loaded = false;
}

/**
 * `list` with each restricted card's audience filled in, once read.
 * @param {object[]} list
 * @param {{ enabled?: boolean }} [options]
 */
export function useArtifactAudiences(list, { enabled = true } = {}) {
  const [version, setVersion] = useState(0);
  if (enabled) restore();
  const wanted = useMemo(
    () => (enabled ? (list || []).filter((a) => needsAudience(a) && !memory.has(keyOf(a))) : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [enabled, list, version],
  );

  useEffect(() => {
    if (!wanted.length) return undefined;
    let live = true;
    const queue = [...wanted];
    const work = async () => {
      while (live && queue.length) {
        const artifact = queue.shift();
        const key = keyOf(artifact);
        try {
          const fields = cardFields(await loadArtifactAudience(artifact));
          // Remembered even when it names nobody, so it isn't asked again.
          memory.set(key, fields || { unknown: true });
        } catch {
          // Not remembered: read again next time the list is shown.
        }
      }
    };
    Promise.all(Array.from({ length: Math.min(CONCURRENCY, queue.length) }, work)).then(() => {
      persist();
      if (live) setVersion((v) => v + 1);
    });
    return () => { live = false; };
  }, [wanted]);

  return useMemo(() => {
    if (!enabled) return list;
    return (list || []).map((artifact) => {
      if (!needsAudience(artifact)) return artifact;
      const fields = memory.get(keyOf(artifact));
      // `audienceRead`: these came from the audience route, not the card, so
      // a badge may name who they reach (ArtifactStatus).
      return fields && !fields.unknown ? { ...artifact, ...fields, audienceRead: true } : artifact;
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, list, version]);
}

export default useArtifactAudiences;
