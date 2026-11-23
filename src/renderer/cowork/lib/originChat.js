// "Open chat" on a preview's rail (ENG-4599): the way from an artifact or doc
// back to the chat it was made in.
//
// The app hands the previews two things through OriginChatContext: `open(id)`
// shows a chat, and `check(id)` says whether one can be opened ('ok',
// 'not_found', 'forbidden' or 'unavailable'). A preview with no provider
// above it has no way to open a chat, so it shows no button.
//
// Whether the chat can be opened is settled when the preview opens, so a
// disabled button says why before anyone clicks it. Most cases need no
// request: no origin chat, the chat on screen already, or, in org mode, a
// colleague's artifact (their chat is never this person's to open).

import { createContext } from 'react';
import { originConversationId } from './artifactIdentity';
import { artifactAuthorship } from './artifactAuthorship';
import { isFromConversation } from './railArtifacts';

/**
 * @typedef {'ok' | 'not_found' | 'forbidden' | 'unavailable'} OriginChatStatus
 * @typedef {{
 *   open: (id: string) => void,
 *   check: (id: string) => Promise<OriginChatStatus>,
 * }} OriginChatHost
 */

/** @type {import('react').Context<OriginChatHost | null>} */
export const OriginChatContext = createContext(null);

// The origin chat is someone else's. In org mode, a colleague's artifact: the
// card carries an authorship marker (no capabilities is no evidence either
// way; the check decides then). Anywhere, a live app copied from what another
// member shared, which keeps their provenance (`receivedFrom`,
// lib/liveAppSharing.js).
function isOthersChat(artifact, orgMode) {
  return (orgMode && !!artifactAuthorship(artifact.capabilities)) || !!artifact.receivedFrom;
}

/**
 * What the rail can say before (or instead of) asking the server.
 *
 * - `hidden`: no button (nothing to open chats with, or this is that chat);
 * - `unavailable` with a `reason` (`noOrigin`, `colleague`): disabled;
 * - `check` with the chat's `id`: ask the host whether it can be opened.
 *
 * @param {{ artifact: object|null, conversationId?: string|null, orgMode?: boolean, canOpen?: boolean }} params
 * @returns {{ kind: 'hidden' } | { kind: 'unavailable', reason: string } | { kind: 'check', id: string }}
 */
export function originChatGate({ artifact, conversationId = null, orgMode = false, canOpen = true }) {
  if (!artifact || !canOpen) return { kind: 'hidden' };
  if (isFromConversation(artifact, conversationId)) return { kind: 'hidden' };
  const id = originConversationId(artifact);
  if (!id) return { kind: 'unavailable', reason: 'noOrigin' };
  if (isOthersChat(artifact, orgMode)) return { kind: 'unavailable', reason: 'colleague' };
  return { kind: 'check', id };
}

/**
 * The app's `check`: a chat deleted here is gone, a chat in the list can be
 * opened, and any other (the list is capped, so an older chat is missing from
 * it) is asked about.
 *
 * @param {string} id
 * @param {{ tasks?: Array<{id?: string}>, deletedIds?: Set<string>, fetchStatus: (id: string) => Promise<OriginChatStatus> }} params
 * @returns {Promise<OriginChatStatus>}
 */
export async function checkOriginChat(id, { tasks = [], deletedIds = new Set(), fetchStatus }) {
  if (deletedIds.has(id)) return 'not_found';
  if (tasks.some((task) => String(task?.id || '') === id)) return 'ok';
  return fetchStatus(id);
}
