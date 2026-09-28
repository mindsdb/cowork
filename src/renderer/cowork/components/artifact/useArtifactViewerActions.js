import { useState } from 'react';
import { unpublishArtifact } from '../../api';
import { deleteArtifactAndSync } from '../../lib/artifactsStore';
import { needsClientUnpublishBeforeDelete } from '../../lib/artifactActions';
import { downloadArtifactFile } from '../../lib/artifactDownload';
import { host } from '../../../platform/host';
import { isAbsoluteArtifactPreviewUrl } from './artifactPreviewUtils';

export function useArtifactViewerActions(artifact, {
  actionPath,
  hasActionPath,
  disabledReason,
  isBackendArtifact,
  backendPort,
  orgMode,
  pub,
  onDelete,
  onClose,
  setError: setErr,
}) {
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const draftPreviewUrl = artifact?.draftUrl || '';
  const isPublished = !!pub.publishedUrl;
  // Backend artifacts treat the folder, not the entry html, as the
  // "thing" the user opens in their OS or browser. Prefer the server's
  // `folder` (the artifact's slug dir) — for fullstack apps the primary
  // sits in a `static/` subdir, so stripping the filename off the path
  // would point at `static/`, not the slug folder. Fall back to that
  // strip for records that don't carry `folder` (e.g. from a chat bubble).
  const artifactFolder = artifact?.folder || actionPath.replace(/[\\/][^\\/]*$/, '') || actionPath;

  // Open the local file only when the file is actually on this machine
  // (Electron + loopback server). When the desktop app points at a REMOTE
  // server, or in web, the path is on the server box, so we fall back to
  // the HTTP serve/published URL.
  const canOpenLocalFile = host.isElectron && host.isLocalApiOrigin();
  const canOpenInBrowser = isPublished || canOpenLocalFile || !!artifact?.serveUrl;

  // Open the artifact's containing folder in the OS file manager.
  const onOpenFolder = async () => {
    if (!canOpenLocalFile) return;
    try {
      const res = await host.openPath(artifactFolder || actionPath);
      if (res && res.ok === false) setErr(res.reason || 'Could not open folder.');
    } catch (error) {
      setErr(error?.message || 'Could not open folder.');
    }
  };

  // Open the published URL in the default browser; falls back to a new
  // window if the OS handoff is unavailable.
  const onOpenPublished = async () => {
    if (!pub.publishedUrl) return;
    try { await host.openExternal(pub.publishedUrl); }
    catch { window.open(pub.publishedUrl, '_blank', 'noreferrer'); }
  };

  // Open the local file / served preview (HTML → default browser, other
  // types → their default app). Handles backend artifacts + the web shell.
  const onOpenOS = async () => {
    if (isBackendArtifact && canOpenLocalFile) {
      if (!backendPort) {
        setErr('Backend port not available yet — preview is still loading.');
        return;
      }
      try { await host.openExternal(`http://127.0.0.1:${backendPort}`); }
      catch (error) { setErr(error?.message || 'Open failed'); }
      return;
    }
    if (!canOpenLocalFile) {
      const rel = artifact?.serveUrl || '';
      const url = rel
        ? (rel.startsWith('http') ? rel : `${host.getApiOrigin()}${rel}`)
        : (pub.publishedUrl || '');
      if (url) {
        try { await host.openExternal(url); }
        catch { window.open(url, '_blank', 'noreferrer'); }
        return;
      }
      setErr('This artifact is served from a remote server and has no open URL yet.');
      return;
    }
    if (!hasActionPath) {
      setErr(disabledReason || 'This artifact does not have a local file path.');
      return;
    }
    try {
      const result = await host.openPath(actionPath);
      if (result && result.ok === false) throw new Error(result.reason || 'Could not open artifact.');
    } catch (error) {
      setErr(error?.message || 'Open failed');
    }
  };

  // The link-pill arrow: published → open the public URL; otherwise → open
  // the local/served preview.
  const onOpenInBrowser = () => (isPublished ? onOpenPublished() : onOpenOS());

  // "Open this artifact in a browser tab", for the control beside the mode
  // tabs. It exists separately from the ⋯ menu's "Open in browser" because
  // that menu is hidden in org mode, where this affordance still belongs.
  //
  // Preference order: the published URL is what the artifact *is* and what a
  // person would share; the served URL is desktop's local HTTP view; the
  // authenticated draft URL is org mode's route to an artifact nobody has
  // published yet.
  const browserTabTarget = pub.publishedUrl || artifact?.serveUrl || draftPreviewUrl || '';
  // ...but only `publishedUrl` carries its own origin; the server returns
  // `serveUrl` and `draftUrl` origin-relative. Web tolerates that because
  // `window.open` resolves against the page, and desktop no longer reaches
  // here with a relative value at all (see `onOpenInBrowserTab` below).
  // Absolutized anyway, through the same helper the draft-preview path above
  // uses, so the value means one thing on both shells: a relative URL handed
  // to `shell.openExternal` opens nothing and reports success (ENG-2847).
  const browserTabUrl = !browserTabTarget || isAbsoluteArtifactPreviewUrl(browserTabTarget)
    ? browserTabTarget
    : `${host.getApiOrigin()}${browserTabTarget}`;
  // On desktop an unpublished artifact CANNOT be opened over the served URL,
  // however well-formed it is: the loopback server requires a bearer token
  // (`require_auth` defaults on in local tenancy), and main injects that token
  // into this window's own session only (`app.ts` webRequest). shell.openExternal
  // launches a separate browser process, which carries no such header and gets
  // 401. The local file needs no credential, so hand it to the OS instead —
  // the same route the ⋯ menu's "Open in browser" takes, which is exactly why
  // that control kept working while this one did not. `onOpenOS` already owns
  // the fullstack-backend and missing-path cases, so delegate rather than
  // restate them.
  //
  // Published stays on openExternal: that URL is public, absolute, and the
  // thing a person actually wants a tab of. Org/web has no local file, so it
  // stays on the URL too.
  //
  // NOT `draftNavigationIsAuthorized` (ENG-2818), despite the matching shape:
  // that answers whether a navigation *inside this window* is authorized, and
  // it is true here — main's header injection covers the app's own requests.
  // This control leaves the window entirely, which is the one case that
  // injection does not reach.
  const onOpenInBrowserTab = () => {
    if (!isPublished && canOpenLocalFile) return onOpenOS();
    if (!browserTabUrl) return;
    host.openExternal(browserTabUrl).catch(() => {
      setErr('Could not open this artifact in a browser.');
    });
  };

  // Universal "save to disk" — type-agnostic stream with
  // Content-Disposition: attachment, through the serve URL on desktop or the
  // authenticated draft URL on an org deployment (ENG-2044).
  const onDownload = async () => {
    if (!(await downloadArtifactFile(artifact, { actionPath }))) {
      setErr(disabledReason || 'This artifact has no downloadable file yet.');
    }
  };

  const onTrash = () => {
    if (pub.busy || deleteBusy) return;
    if (!hasActionPath) {
      setErr(disabledReason || 'This artifact does not have a local file path.');
      return;
    }
    setConfirmDelete(true);
  };

  const onConfirmDelete = async () => {
    // Deletion is centralized through cowork-server (not shell.trashItem)
    // so the server's unpublish-before-delete guard always runs. The whole
    // artifact folder is removed (not just the primary file) so metadata.json
    // goes too and the artifact disappears from the listing.
    setDeleteBusy(true);
    setErr('');
    try {
      // Desktop's path-addressed delete needs a client-side unpublish first.
      // SaaS performs both operations atomically on the scoped server route.
      if (needsClientUnpublishBeforeDelete({ orgMode, published: isPublished })) {
        await unpublishArtifact(actionPath);
      }
      await deleteArtifactAndSync(artifact);
      setConfirmDelete(false);
      onDelete?.(actionPath);
      onClose?.();
    } catch (error) {
      setConfirmDelete(false);
      setErr(error?.message || 'Delete failed');
    } finally {
      setDeleteBusy(false);
    }
  };

  return {
    confirmDelete,
    setConfirmDelete,
    deleteBusy,
    canOpenLocalFile,
    canOpenInBrowser,
    browserTabUrl,
    onOpenFolder,
    onOpenOS,
    onOpenInBrowser,
    onOpenInBrowserTab,
    onDownload,
    onTrash,
    onConfirmDelete,
  };
}
