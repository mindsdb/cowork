// One live copy per inline artifact (ENG-4684).
//
// The agent updates an inline chart over several turns, and every turn's card
// would otherwise show its own live frame of the same draft. As with skill
// cards (skillCards.js), only the LATEST card that shows an artifact inline
// keeps the frame; earlier ones fold to a one-line chip ("updated below").
//
// A card is a message's own `artifact`, or one of its `Artifact` steps, in the
// order ChatView renders them: the message's card first, then its steps.

import { artifactIdentity } from './artifactIdentity';
import { isBackendArtifact, isHtmlArtifact, isInlineArtifact } from './artifactKinds';

/** The slot of a message's own `artifact` card, beside its steps' ids. */
export const MESSAGE_CARD_SLOT = 'message-card';

/** Which artifact a card is, across turns; '' when it names none. */
export function inlineArtifactKey(card) {
  if (!card) return '';
  return artifactIdentity(card) || card.slug || card.canonicalPath || card.file_path || card.path || '';
}

/**
 * Whether a card would show inline at all: the kind test ArtifactCard starts
 * from (the deployment gates it adds can only turn a frame off, never on).
 */
export function showsInline(card) {
  if (!card) return false;
  const path = card.file_path || card.path || '';
  return isInlineArtifact(card) && isHtmlArtifact({ ...card, path }) && !isBackendArtifact(card);
}

/**
 * Scan messages in order (the streaming message last) and return, per
 * artifact key, where its last inline card is: `{ index, slot }`.
 *
 * @param {Array<{ artifact?: object, steps?: Array }>} messages
 * @returns {Map<string, { index: number, slot: string }>}
 */
export function latestInlineArtifactByKey(messages) {
  const latest = new Map();
  const note = (card, index, slot) => {
    if (!showsInline(card)) return;
    const key = inlineArtifactKey(card);
    if (key) latest.set(key, { index, slot });
  };
  (messages || []).forEach((m, i) => {
    if (m?.artifact) note(m.artifact, i, MESSAGE_CARD_SLOT);
    (m?.steps || []).forEach((s) => {
      if (s?.badge === 'Artifact') note(s.data, i, s.id);
    });
  });
  return latest;
}

/**
 * True when a later card shows this artifact inline, so this one folds.
 * False without a map, or for a card that is not in it.
 */
export function isSupersededInline(latest, card, index, slot) {
  if (!latest || index == null) return false;
  const at = latest.get(inlineArtifactKey(card));
  return !!at && (at.index !== index || at.slot !== slot);
}

/** The revision a card was made at, when the server says (else ''). */
export function cardRevisionId(card) {
  const value = card?.revision_id ?? card?.revisionId ?? '';
  return typeof value === 'string' ? value : '';
}
