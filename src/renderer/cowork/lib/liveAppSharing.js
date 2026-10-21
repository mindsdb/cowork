/*
 * Sharing a live app: a full-stack app that runs outside cowork-server and
 * opens only for the person who launched it. Its owner shares it with a
 * colleague by email; the colleague duplicates it into their own project after
 * a disclaimer, and the copy runs with the colleague's own connections. The
 * owner can instead share it with everyone on the stack, and can stop any
 * share. Nobody opens another person's running app: the edge serves app<n>
 * only when cowork-server's `GET /api/v1/live-apps/<n>/access` answers 200,
 * which it does only for the signed-in person who launched the app slot n
 * runs now.
 *
 * cowork-server decides all of it: `POST /artifacts/live-app-share`,
 * `GET /artifacts/live-app-shares`, `DELETE /artifacts/live-app-share/<id>`,
 * `GET /artifacts/shared-live-apps` and `POST /artifacts/live-app-duplicate`
 * answer 404 unless the deployment runs live apps, and refuse a share or a
 * duplicate they don't allow. These helpers only decide what to show, and
 * every control they gate stays hidden unless /health reports `live_apps`
 * (lib/liveApps.ts).
 */

import { isBackendArtifact } from './artifactKinds';
import { OTHER_ACTOR_LABEL } from './sharedResourceAccess';

/**
 * One app another person shared with the caller, as
 * `GET /artifacts/shared-live-apps` lists it.
 *
 * @typedef {object} SharedLiveApp
 * @property {string} shareId
 * @property {string} slug
 * @property {string} name
 * @property {string} description
 * @property {string} ownerEmail One of the two places the server names another
 *   member, with `receivedFrom` on a copy's card, and only to someone that
 *   member shared with.
 * @property {boolean} everyone Shared with everyone on the stack, not by name.
 * @property {string} sharedAt
 */

/**
 * One share of the caller's own app, as `POST /artifacts/live-app-share`
 * answers it and `GET /artifacts/live-app-shares` lists it.
 *
 * @typedef {object} LiveAppShare
 * @property {string} shareId
 * @property {string} slug
 * @property {string | null} email Null for a share with everyone.
 * @property {boolean} everyone
 * @property {string} sharedAt
 */

/**
 * Who a duplicated app came from, as every artifact card carries it.
 *
 * @typedef {{ email: string }} ReceivedFrom
 */

export const SHARE_LIVE_APP_LABEL = 'Share with…';
export const SHARE_WITH_ONE = 'one';
export const SHARE_WITH_EVERYONE = 'everyone';
export const SHARE_WITH_EVERYONE_LABEL = 'Everyone on this stack';
export const SHARED_WITH_YOU_LABEL = 'Shared with you';

/**
 * Whether the card offers "Share with…": a full-stack app the viewer owns,
 * on a deployment that runs live apps. The slug and project are what the
 * share route names the app by.
 *
 * @param {object | null | undefined} artifact An artifact card.
 * @param {boolean} liveApps
 */
export function canShareLiveApp(artifact, liveApps) {
  return liveApps === true
    && isBackendArtifact(artifact)
    && Boolean(artifact?.slug)
    && Boolean(artifact?.projectId)
    && artifact?.capabilities?.canEdit !== false;
}

/**
 * Whether a card is an unpublished live app, which shares by "Share with…"
 * only: cowork-server refuses to publish a full-stack app as a page, so the
 * page Share item and its "Not shared" pill could only mislead there.
 *
 * @param {object | null | undefined} artifact An artifact card.
 * @param {boolean} liveApps
 */
export function isLiveAppCard(artifact, liveApps) {
  return liveApps === true && isBackendArtifact(artifact) && !artifact?.publishedUrl;
}

/**
 * The sharer as the viewer may see them: their email, else "Another member".
 *
 * @param {unknown} email
 */
export function ownerLabel(email) {
  return typeof email === 'string' && email.trim() ? email.trim() : OTHER_ACTOR_LABEL;
}

/**
 * Who shared an app in "Shared with you", and whether it went to everyone.
 *
 * @param {SharedLiveApp | null | undefined} app
 */
export function sharedByLine(app) {
  const from = `From ${ownerLabel(app?.ownerEmail)}`;
  return app?.everyone === true ? `${from} · shared with everyone` : from;
}

/**
 * The copy's "received from" line, or null for an artifact nobody shared.
 *
 * @param {{ receivedFrom?: ReceivedFrom | null } | null | undefined} artifact
 */
export function receivedFromLine(artifact) {
  const from = artifact?.receivedFrom;
  if (!from || typeof from !== 'object') return null;
  return `Received from ${ownerLabel(from.email)}`;
}

/**
 * Who one of the owner's shares reaches, as the share dialog lists it.
 *
 * @param {LiveAppShare} share
 */
export function shareAudienceLabel(share) {
  return share?.everyone === true ? SHARE_WITH_EVERYONE_LABEL : String(share?.email ?? '');
}

/** @param {SharedLiveApp | null | undefined} app */
export function duplicateDisclaimerTitle(app) {
  return `Duplicate "${app?.name || app?.slug || 'this app'}"?`;
}

/**
 * What the colleague confirms before cowork-server copies the app. "Shared",
 * not "built": a received copy can be shared on, and its sharer didn't write it.
 *
 * @param {SharedLiveApp | null | undefined} app
 */
export function duplicateDisclaimer(app) {
  return `${ownerLabel(app?.ownerEmail)} shared this app. Your copy runs with your own connections `
    + 'and can read whatever they can read. Review it before you launch it.';
}

/**
 * The shared list as the server sent it, keeping only the entries the rail
 * can act on.
 *
 * @param {unknown} data
 * @returns {SharedLiveApp[]}
 */
export function sharedLiveAppsFrom(data) {
  if (!Array.isArray(data)) return [];
  return data
    .filter((item) => item && typeof item.shareId === 'string' && item.shareId)
    .map((item) => ({
      shareId: item.shareId,
      slug: String(item.slug ?? ''),
      name: String(item.name || item.slug || ''),
      description: String(item.description ?? ''),
      ownerEmail: String(item.ownerEmail ?? ''),
      everyone: item.everyone === true,
      sharedAt: String(item.sharedAt ?? ''),
    }));
}

/**
 * The owner's shares of one app as the server sent them, keeping only the
 * entries the dialog can stop.
 *
 * @param {unknown} data
 * @returns {LiveAppShare[]}
 */
export function liveAppSharesFrom(data) {
  if (!Array.isArray(data)) return [];
  return data
    .filter((item) => item && typeof item.shareId === 'string' && item.shareId)
    .map((item) => ({
      shareId: item.shareId,
      slug: String(item.slug ?? ''),
      email: typeof item.email === 'string' && item.email ? item.email : null,
      everyone: item.everyone === true,
      sharedAt: String(item.sharedAt ?? ''),
    }));
}
