// Where a framed HTML preview gets its page from: the one function the
// artifact viewer and the inline chat card (ENG-4684) both load through, so
// the two cannot disagree on how a deployment serves a draft.
//
// It resolves to exactly one of `url` (the frame navigates) or `doc` (the
// frame renders it through `srcdoc`), and never touches React state: the
// caller owns cancellation, the loading flag and what it shows on failure.
//
//   - Org web with signed draft links: a fresh link on the draft host, so the
//     page carries that host's CSP (CDN scripts, fonts and images load).
//   - A draft URL the frame can navigate to (embedded, cross-origin, or the
//     desktop loopback that injects the bearer itself): that URL.
//   - Any other draft URL: fetched with the credential and inlined into a
//     srcdoc document, because a frame navigation cannot carry it.
//   - A fullstack app on an org deployment (`publishedApp`, ENG-4687): its
//     published address, where it already runs, since the server can't start
//     its backend there; a restricted one through the view host's session
//     bootstrap, so it opens signed in.
//   - Otherwise (desktop / local web): mounted by path, as a static bundle
//     or, for a fullstack app, behind the loopback proxy.

import { mountArtifactPreview } from '../../api';
import {
  artifactRef as artifactWorkspaceRef,
  createDraftLink,
  loadArtifactDraftDocument,
  loadArtifactRevision,
} from '../../lib/artifactWorkspaceApi';
import { absoluteDraftUrl, inlineArtifactFrameDocument } from './workspace/inlineArtifactFrame';
import { draftLinksWithdrawal, draftLinkUrl } from '../../lib/draftLinkRules';
import { setDraftLinks } from '../../../lib/draftLinks';
import { inlineHtmlFromApi } from '../../lib/inlineHtmlAssets';
import { BACKEND_ARTIFACT_TYPES } from '../../lib/artifactKinds';
import { getAccessToken, host } from '../../../platform/host';
import { viewSessionFrameUrl } from '../../../lib/viewSession';
import { diagnostic } from '../../../../shared/diagnostics';
import i18n from '../../../lib/i18n';
import {
  canFetchDraftWithCredentials,
  draftDirectoryUrl,
  draftFileName,
  draftNavigationIsAuthorized,
  draftPreviewErrorMessage,
  injectDraftBaseHref,
  isAbsoluteArtifactPreviewUrl,
  limitArtifactFrames,
  withArtifactCommentFlag,
  withArtifactVersion,
} from './artifactPreviewUtils';

const tr = (key) => i18n.t(key, { ns: 'artifacts' });

// A published app's address, for the preview frame: an https page on
// another origin than this page and its API, or ''. The frame keeps the app's
// origin (allow-same-origin), which is safe only because that origin is not
// Cowork's: a page on Cowork's own origin with scripts and same-origin could
// reach the shell around it.
export function publishedAppUrl(value) {
  try {
    const url = new URL(String(value || ''));
    if (url.protocol !== 'https:') return '';
    const own = [window.location?.origin, host.getApiOrigin?.()].filter(Boolean)
      .map((origin) => { try { return new URL(origin).origin; } catch { return ''; } });
    return own.includes(url.origin) ? '' : url.href;
  } catch {
    return '';
  }
}

/**
 * A failed load. `message` is the sentence to show; `cause` the original
 * error; `stage` where it failed, so a caller can tell a refused draft link
 * (which turns links off: see withdrawDraftLinks) from the rest.
 */
export class HtmlPreviewError extends Error {
  constructor(message, { cause = null, stage = '' } = {}) {
    super(message);
    this.name = 'HtmlPreviewError';
    this.cause = cause;
    this.stage = stage;
  }
}

/**
 * Turns draft links off for this page when a failed request says so
 * (draftLinksWithdrawal), and logs why: a page that silently stops using
 * links would hide a misconfigured draft host. Every preview then reloads
 * through srcdoc. True when links went off.
 */
export async function withdrawDraftLinks(error) {
  const event = await draftLinksWithdrawal(error, host.checkConfigured);
  if (!event) return false;
  diagnostic('renderer.cowork.components.artifact.htmlPreviewSource', 'WARNING', event, error);
  setDraftLinks(false);
  return true;
}

/**
 * Whether a signed draft link is the way to load this artifact's draft:
 * org web with links on, and a draft on this server's own drafts route (an
 * embedded or another origin's draft URL keeps its own route).
 */
export function usesDraftLink(artifact, draftLinksOn) {
  const draftUrl = artifact?.draftUrl || '';
  return host.isWeb && !!draftLinksOn
    && !!draftUrl && canFetchDraftWithCredentials(draftUrl, host.getApiOrigin());
}

function withFlags(url, cacheVersion, withCommentLayer) {
  const versioned = withArtifactVersion(url, cacheVersion);
  return withCommentLayer ? withArtifactCommentFlag(versioned) : versioned;
}

/**
 * @param {object} options
 * @param {object} options.artifact
 * @param {string} options.actionPath    the local path the desktop mount reads
 * @param {boolean} options.hasActionPath a usable local path (none disabled)
 * @param {string} options.cacheVersion  cache-buster for the frame's URL
 * @param {boolean} [options.withCommentLayer]
 * @param {boolean} [options.draftLinkEnabled] see usesDraftLink
 * @param {AbortSignal} [options.signal] aborts the srcdoc inlining
 * @param {{ url: string, accessMode?: string } | null} [options.publishedApp]
 *   an org deployment's fullstack app: where it's published, and its access.
 *   Only the viewer passes it; its frame keeps the app's own origin.
 * @returns {Promise<{
 *   kind: 'static' | 'proxy' | 'published',
 *   url: string,
 *   doc: string,
 *   port: number | null,
 *   expiresAt: string | number | null,
 * }>}
 */
export async function loadHtmlPreview({
  artifact,
  actionPath,
  hasActionPath,
  cacheVersion,
  withCommentLayer = false,
  draftLinkEnabled = false,
  signal,
  publishedApp = null,
}) {
  const draftPreviewUrl = artifact?.draftUrl || '';
  const isBackend = BACKEND_ARTIFACT_TYPES.has(artifact?.type);
  const result = (fields) => ({ kind: 'static', url: '', doc: '', port: null, expiresAt: null, ...fields });

  // An org deployment can't start a fullstack app's backend (preview-mount is
  // desktop-only), but the app already runs at its published address: it's
  // published for its owner alone when it's created. The frame shows that
  // page, which lets this Cowork web app be its ancestor (mindshub_services'
  // frame-ancestors). A restricted one (owner-only included) opens through the
  // view host's session bootstrap, not its sign-in redirect, which can't be
  // framed. An address that isn't an https page is no preview.
  if (isBackend && publishedApp) {
    const liveUrl = publishedAppUrl(publishedApp.url);
    if (!liveUrl) throw new HtmlPreviewError(tr('viewer.appNotPublishedYet'), { stage: 'published' });
    const framed = withArtifactVersion(liveUrl, cacheVersion);
    const url = publishedApp.accessMode === 'restricted'
      ? await viewSessionFrameUrl(framed, getAccessToken)
      : framed;
    return result({ kind: 'published', url });
  }

  if (draftPreviewUrl && (!isBackend || !hasActionPath)) {
    const linkRef = draftLinkEnabled ? artifactWorkspaceRef(artifact) : null;
    if (linkRef) {
      // A new link on every load: each expires (the caller reads `expiresAt`).
      // A link outside the draft hosts is refused here (draftLinkUrl throws),
      // which turns links off like a failed request does.
      let link;
      let linked;
      try {
        link = await createDraftLink(linkRef.projectRef, linkRef.artifactId);
        linked = draftLinkUrl(link);
      } catch (e) {
        throw new HtmlPreviewError(draftPreviewErrorMessage(e, tr('viewer.loadDraftFailed')), { cause: e, stage: 'draft-link' });
      }
      return result({ url: withFlags(linked, cacheVersion, withCommentLayer), expiresAt: link.expiresAt });
    }
    const rawUrl = isAbsoluteArtifactPreviewUrl(draftPreviewUrl)
      ? draftPreviewUrl
      : `${host.getApiOrigin()}${draftPreviewUrl}`;
    const fetchUrl = withFlags(rawUrl, cacheVersion, withCommentLayer);
    // Navigate unless fetch+srcdoc is the only way to carry a credential: a
    // srcdoc document inherits the shell's CSP, which blocks the artifact's
    // CDN scripts, web fonts and remote images (ENG-2818). Embedded content
    // needs no credential, a cross-origin URL must never get one, and the
    // desktop loopback injects it at the network layer.
    const shouldNavigate = !canFetchDraftWithCredentials(rawUrl, host.getApiOrigin())
      || draftNavigationIsAuthorized(host.isElectron, host.isLocalApiOrigin());
    if (shouldNavigate) return result({ url: fetchUrl });
    // Org deployment: the forward-auth ingress in front of the drafts route
    // reads only `Authorization: Bearer`, which a frame navigation cannot
    // send, so the draft is fetched and rendered through srcdoc.
    let doc;
    try {
      doc = await loadArtifactDraftDocument(fetchUrl);
    } catch (e) {
      throw new HtmlPreviewError(draftPreviewErrorMessage(e, tr('viewer.loadDraftFailed')), { cause: e, stage: 'draft' });
    }
    if (!doc.isHtml) {
      // Expected only on Desktop (org mode offers .html here): the frame
      // fetches the URL again, which the loopback serves.
      return result({ url: fetchUrl });
    }
    // The files the draft loads from its folder can't carry the token either,
    // so they are inlined with it. The inliner never reads above the draft's
    // own folder. If inlining fails, the draft still shows as it loaded.
    const html = await inlineHtmlFromApi(doc.content, {
      rootUrl: draftDirectoryUrl(fetchUrl),
      filePath: draftFileName(fetchUrl),
      signal,
      chatWorkspaces: false,
    }).catch(() => injectDraftBaseHref(doc.content, fetchUrl));
    return result({ doc: limitArtifactFrames(html) });
  }

  let mounted;
  try {
    mounted = await mountArtifactPreview(actionPath);
  } catch (e) {
    throw new HtmlPreviewError(e?.message || tr('viewer.loadFailed'), { cause: e, stage: 'mount' });
  }
  const { kind, url, artifactDir, port, proxyUrl, backendRunning, launchError } = mounted || {};
  if (kind === 'proxy') {
    if (!artifactDir) throw new HtmlPreviewError(tr('viewer.noArtifactDir'), { stage: 'mount' });
    if (backendRunning === false) {
      throw new HtmlPreviewError(launchError || tr('viewer.backendFailed'), { stage: 'mount' });
    }
    if (!proxyUrl) throw new HtmlPreviewError(tr('viewer.proxyUnavailable'), { stage: 'mount' });
    let iframeUrl = proxyUrl;
    try {
      const u = new URL(proxyUrl);
      if (window.location?.protocol) u.protocol = window.location.protocol;
      if (window.location?.hostname) u.hostname = window.location.hostname;
      iframeUrl = u.toString();
    } catch { /* fall through with the raw URL */ }
    // The proxy injects the comment marker layer on the same activation flag
    // (preview_proxy.py), baked in at mount time so the src stays stable.
    return result({
      kind: 'proxy',
      url: withFlags(iframeUrl, cacheVersion, withCommentLayer),
      port: typeof port === 'number' ? port : null,
    });
  }
  if (!url) throw new HtmlPreviewError(tr('viewer.noMountUrl'), { stage: 'mount' });
  // The inert comment bridge goes into the first URL whenever asked for, so
  // transport readiness can change without swapping the frame's `src`.
  return result({ url: withFlags(url, cacheVersion, withCommentLayer) });
}

/**
 * One saved revision of the page, for a frame that shows the artifact as it
 * was (an earlier chat card, ENG-4684): the revision's source from the
 * workspace history, with its folder files inlined as the revision comparison
 * inlines them. Resolves to `{ doc }`; it never navigates.
 *
 * @param {{ artifact: object, revisionId: string, signal?: AbortSignal }} options
 */
export async function loadHtmlRevision({ artifact, revisionId, signal }) {
  let revision;
  try {
    revision = await loadArtifactRevision(artifact, revisionId);
  } catch (e) {
    throw new HtmlPreviewError(draftPreviewErrorMessage(e, tr('viewer.loadFailed')), { cause: e, stage: 'revision' });
  }
  const content = typeof revision?.content === 'string' ? revision.content : '';
  if (!content) throw new HtmlPreviewError(tr('viewer.loadFailed'), { stage: 'revision' });
  const html = await inlineArtifactFrameDocument(content, absoluteDraftUrl(artifact?.draftUrl || ''), { signal });
  return { doc: limitArtifactFrames(html) };
}
