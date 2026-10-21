/*
 * Sharing a live app: a full-stack app that runs outside cowork-server and
 * opens only for the person who launched it. Its owner shares it with a
 * colleague by email; the colleague duplicates it into their own project after
 * a disclaimer, and the copy runs with the colleague's own connections. The
 * owner can instead share it with everyone on the stack. Nobody opens another
 * person's running app.
 *
 * cowork-server decides all of it: `POST /artifacts/live-app-share`,
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
 * @property {string} ownerEmail The one place the server names another member,
 *   and only to someone that member shared with.
 * @property {boolean} everyone Shared with everyone on the stack, not by name.
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
export const SHARED_WITH_YOU_LABEL = 'Shared with you';

/**
 * Whether the card offers "Share with…": a full-stack app the viewer owns,
 * on a deployment that runs live apps. The slug and project are what the
 * share route names the app by.
 */
export function canShareLiveApp(artifact, liveApps) {
  return liveApps === true
    && isBackendArtifact(artifact)
    && Boolean(artifact?.slug)
    && Boolean(artifact?.projectId)
    && artifact?.capabilities?.canEdit !== false;
}

/** The sharer as the viewer may see them: their email, else "Another member". */
export function ownerLabel(email) {
  return typeof email === 'string' && email.trim() ? email.trim() : OTHER_ACTOR_LABEL;
}

/** Who shared an app in "Shared with you", and whether it went to everyone. */
export function sharedByLine(app) {
  const email = typeof app?.ownerEmail === 'string' ? app.ownerEmail.trim() : '';
  const from = email ? `From ${email}` : 'From another member';
  return app?.everyone === true ? `${from} · shared with everyone` : from;
}

/** The copy's "received from" line, or null for an artifact nobody shared. */
export function receivedFromLine(artifact) {
  const from = artifact?.receivedFrom;
  if (!from || typeof from !== 'object') return null;
  return `Received from ${ownerLabel(from.email)}`;
}

/**
 * Whether the share dialog's address is worth sending. Loose on purpose:
 * cowork-server validates the address and answers with the sentence to show.
 */
export function isEmailLike(value) {
  return /^[^\s@]+@[^\s@]+$/.test(String(value ?? '').trim());
}

export function duplicateDisclaimerTitle(app) {
  return `Duplicate "${app?.name || app?.slug || 'this app'}"?`;
}

/** What the colleague confirms before cowork-server copies the app. */
export function duplicateDisclaimer(app) {
  return `${ownerLabel(app?.ownerEmail)} built this app. Your copy runs with your own connections `
    + 'and can read whatever they can read. Review it before you launch it.';
}

/**
 * The shared list as the server sent it, keeping only the entries the rail
 * can act on. A 404 means the deployment runs no live apps, which lists
 * nothing rather than failing.
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
