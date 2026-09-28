import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { artifactServeUrl, mountArtifactPreview, previewArtifact } from '../../api';
import { loadArtifactDraftText, loadArtifactDraftDocument } from '../../lib/artifactWorkspaceApi';
import { isImageArtifact } from '../../lib/artifactKinds';
import { useBlobImageSrc } from '../AttachmentThumbnail';
import { host } from '../../../platform/host';
import {
  artifactExtension,
  countCsvRows,
  csvRowsToGfmTable,
  CSV_PREVIEW_ROW_LIMIT,
  draftNavigationIsAuthorized,
  draftPreviewErrorMessage,
  isTextArtifact,
  isAbsoluteArtifactPreviewUrl,
  canFetchDraftWithCredentials,
  injectDraftBaseHref,
  parseCsv,
  withArtifactCommentFlag,
  withArtifactVersion,
} from './artifactPreviewUtils';

export function useArtifactPreview(artifact, {
  open,
  actionPath,
  hasActionPath,
  disabledReason,
  isBackendArtifact,
  commentLayerRequested,
  setError: setErr,
}) {
  const draftPreviewUrl = artifact?.draftUrl || '';
  const hasPreviewSource = hasActionPath || !!draftPreviewUrl;
  // Mounted preview URL — iframe loads this with `src=` so relative
  // `<script>` / `<link>` refs in the HTML resolve against a real URL.
  // (srcdoc has no base URL → relative refs 404.)
  const [previewUrl, setPreviewUrl] = useState('');
  // Fetched draft HTML rendered via the iframe's `srcdoc` instead of `src=`
  // — set only by the draft-preview branch below (see
  // docs/artifact-collaboration-workflow/task-org-draft-preview-401.md).
  // Kept separate from `previewUrl` (always exactly one of the two is
  // non-empty) rather than merged into one variant type: every existing
  // `src=`-based preview path — proxy, locally-mounted static — is untouched
  // by that fix and keeps reading `previewUrl` exactly as before.
  const [previewDoc, setPreviewDoc] = useState('');
  // 'static' (HTML asset bundle) | 'proxy' (fullstack) — the comment marker
  // layer is server-injected only on the static serve path, so the pin/mode
  // affordance and the activation flag are gated on this.
  const [previewKind, setPreviewKind] = useState('');
  // Whether the iframe has finished its first paint — drives the loading
  // placeholder so it lingers past "URL is ready" until content is visible.
  const [iframeReady, setIframeReady] = useState(false);
  // Text preview state for .md/.txt/.csv — populated via
  // `/v1/artifacts/preview`. Holds `{ content, truncated, mime }`.
  const [textPreview, setTextPreview] = useState(null);
  const [loading, setLoading] = useState(false);
  const [backendPort, setBackendPort] = useState(null);
  // Manual-reload counter — bumped by the link-pill reload button to
  // force a fresh mount/fetch even when the artifact's mtime is unchanged.
  const [reloadNonce, setReloadNonce] = useState(0);
  // Per-open counter used as a cache-buster fallback for artifacts whose
  // object carries no `mtime` (e.g. chat-bubble previews built from stream
  // steps). Increments only when there's no mtime, so every (re)open of
  // such an artifact fetches fresh content (ENG-375).
  const openNonceRef = useRef(0);

  const isText = isTextArtifact(artifact);
  const textExt = isText
    ? ((artifact?.ext || '').toLowerCase() || artifactExtension(actionPath))
    : '';
  // Image artifacts skip the HTML mount pipeline entirely (there's no server
  // dir to register for iframe serving) and load straight from the artifact's
  // serve URL — same CSP workaround as AttachmentThumbnail (fetch + blob:,
  // since a direct loopback <img src> is blocked). `withArtifactVersion` busts the
  // fetch on a content change or a manual reload, matching the iframe/text
  // cache-busting below.
  const isImage = isImageArtifact(artifact);
  const imageRawUrl = isImage ? artifactServeUrl(artifact) : '';
  const imageUrl = imageRawUrl
    ? withArtifactVersion(imageRawUrl, `${artifact?.mtime ?? 0}.${reloadNonce}`)
    : '';
  const { src: imageSrc, failed: imageFailed } = useBlobImageSrc({ url: imageUrl || null });

  // Reset the painted flag whenever the mounted preview changes so the
  // placeholder reappears for the new content.
  useEffect(() => { setIframeReady(false); }, [previewUrl, previewDoc]);

  // Mount the artifact when opened.
  //   - Text (.md/.txt/.csv): skip the iframe entirely and fetch the
  //     body via `/v1/artifacts/preview` so we can render it inline.
  //   - Static (HTML-only): server registers the parent dir under a
  //     token and returns a URL that serves the entry HTML; sibling
  //     assets resolve naturally because they share the URL prefix.
  //   - Proxy (backend+frontend): main hosts a loopback HTTP forwarder
  //     pointed at the artifact's backend port (read lazily from
  //     metadata.json on every request, so a restarted backend on a
  //     new port keeps working).
  useEffect(() => {
    if (!open || !artifact) return;
    if (!hasPreviewSource) {
      setPreviewUrl('');
      setTextPreview(null);
      setErr(disabledReason || 'This artifact does not have a local file path.');
      return;
    }
    setLoading(true);
    setErr('');
    setPreviewUrl('');
    setPreviewDoc('');
    setPreviewKind('');
    setBackendPort(null);
    setTextPreview(null);
    let cancelled = false;
    if (isText) {
      const previewRequest = draftPreviewUrl
        ? loadArtifactDraftText(draftPreviewUrl, {
            // The same split the draft-HTML branch makes below, so a
            // data:/blob: or cross-origin draft renders here too instead of
            // failing only for text.
            withCredentials: canFetchDraftWithCredentials(draftPreviewUrl, host.getApiOrigin()),
          })
        : previewArtifact(actionPath);
      previewRequest
        .then((data) => {
          if (cancelled) return;
          if (!data || typeof data.content !== 'string') {
            throw new Error('Preview returned no content');
          }
          setTextPreview({
            content: data.content,
            truncated: !!data.truncated,
            mime: data.mime || '',
          });
        })
        .catch((error) => { if (!cancelled) setErr(draftPreviewErrorMessage(error)); })
        .finally(() => { if (!cancelled) setLoading(false); });
      return () => { cancelled = true; };
    }
    if (isImage) {
      // The `imageSrc` hook above does its own fetch keyed on `imageUrl`;
      // nothing to mount server-side for a plain image file.
      setLoading(false);
      return () => { cancelled = true; };
    }
    // Cache-buster for the iframe so a content change (or just reopening /
    // a manual reload) fetches fresh content instead of the webview's
    // first-loaded copy. Prefer the server's content `mtime` — it changes
    // only on a real edit — and fold in the per-open nonce + manual-reload
    // counter so reopens and the reload button always re-fetch.
    // Workspace saves explicitly bump reloadNonce below. Keeping the initial
    // revision response out of this key prevents a just-painted iframe from
    // being thrown away merely because editing metadata finished loading.
    const baseVersion = artifact?.mtime || (openNonceRef.current += 1);
    const cacheVersion = `${baseVersion}.${reloadNonce}`;
    if (draftPreviewUrl && !isText && (!isBackendArtifact || !hasActionPath)) {
      const rawUrl = isAbsoluteArtifactPreviewUrl(draftPreviewUrl)
        ? draftPreviewUrl
        : `${host.getApiOrigin()}${draftPreviewUrl}`;
      const fetchUrl = commentLayerRequested
        ? withArtifactCommentFlag(withArtifactVersion(rawUrl, cacheVersion))
        : withArtifactVersion(rawUrl, cacheVersion);
      setPreviewKind('static');
      // Navigate the iframe unless fetch+srcdoc is the only way to carry a
      // credential. Navigation is the preferred path, not merely an
      // equivalent one: a `srcdoc` document inherits the shell's CSP, which
      // blocks the artifact's CDN scripts, web fonts and remote images — the
      // same file renders completely in a browser (ENG-2818).
      //
      // Three cases navigate, and only the third is about authorization —
      // hence `shouldNavigate` rather than a name claiming all three are
      // authorized, which the first two are not:
      //
      //  - Embedded (data:/blob:) content makes no network request at all, so
      //    there is nothing for a credential to protect.
      //  - A genuinely cross-origin absolute URL must never receive the web
      //    Keycloak bearer `authFetch` would attach (the old `src=`
      //    navigation never sent it either), so navigating is the only safe
      //    option rather than an authorized one.
      //  - Desktop against the local loopback, where the main process already
      //    injects the bearer into iframe navigations at the network layer,
      //    so the 401 below cannot occur. See draftNavigationIsAuthorized.
      const shouldNavigate =
        !canFetchDraftWithCredentials(rawUrl, host.getApiOrigin())
        || draftNavigationIsAuthorized(host.isElectron, host.isLocalApiOrigin());
      if (shouldNavigate) {
        setPreviewUrl(fetchUrl);
        setLoading(false);
        return () => { cancelled = true; };
      }
      // Org deployment: a plain iframe `src=` navigation cannot carry the
      // Authorization header the forward-auth ingress in front of the drafts
      // endpoint requires (the ingress `auth-url` reads only
      // `Authorization: Bearer`), so fetch through authFetch (like Edit's
      // source load) and hand the result to the iframe via srcdoc instead of
      // navigating it directly. This path pays the inherited-CSP cost above;
      // lifting it for Cloud needs an ingress change (ENG-2818).
      // previewUrl/previewDoc were both already reset to '' at the top of
      // this effect, so setting only one of them here is enough to keep them
      // mutually exclusive.
      loadArtifactDraftDocument(fetchUrl)
        .then((doc) => {
          if (cancelled) return;
          if (doc.isHtml) {
            setPreviewDoc(injectDraftBaseHref(doc.content, fetchUrl));
          } else {
            // Non-HTML draft content type: org mode's draft preview only ever
            // offers .html here (md/txt/csv already took the isText branch
            // above), so this is expected only on Desktop. The fetch above
            // already ran, so the iframe fetching fetchUrl again is a second
            // round-trip — acceptable on Desktop's local loopback server; on
            // web it degrades to the pre-fix behavior (the iframe navigation
            // may hit the same 401 this task fixes for HTML), which is no
            // worse than before this change.
            setPreviewUrl(fetchUrl);
          }
        })
        .catch((error) => {
          if (cancelled) return;
          setErr(draftPreviewErrorMessage(error, 'Could not load this draft'));
        })
        .finally(() => { if (!cancelled) setLoading(false); });
      return () => { cancelled = true; };
    }
    mountArtifactPreview(actionPath)
      .then(async ({ kind, url, artifactDir, port, proxyUrl, backendRunning, launchError }) => {
        if (kind === 'proxy') {
          if (!artifactDir) throw new Error('Preview mount returned no artifact dir');
          if (backendRunning === false) {
            throw new Error(launchError || 'Backend failed to start');
          }
          if (!proxyUrl) throw new Error('Preview proxy unavailable');
          let iframeUrl = proxyUrl;
          try {
            const proxyAddress = new URL(proxyUrl);
            if (window.location?.protocol) proxyAddress.protocol = window.location.protocol;
            if (window.location?.hostname) proxyAddress.hostname = window.location.hostname;
            iframeUrl = proxyAddress.toString();
          } catch { /* fall through with the raw URL */ }
          if (cancelled) return;
          setPreviewKind('proxy');
          // Fullstack previews flow through the proxy, which injects the marker
          // layer into the root HTML on the same activation flag (see
          // preview_proxy.py). Bake it in at mount time — same rationale as the
          // static branch below (stable src, no reactive reload).
          setPreviewUrl(commentLayerRequested
            ? withArtifactCommentFlag(withArtifactVersion(iframeUrl, cacheVersion))
            : withArtifactVersion(iframeUrl, cacheVersion));
          if (typeof port === 'number') setBackendPort(port);
          return;
        }
        if (!url) throw new Error('Preview mount returned no URL');
        if (cancelled) return;
        setPreviewKind('static');
        // Bake the inert comment bridge into the first URL whenever the card
        // has a stable identity. Transport readiness can then change without
        // swapping this cross-origin iframe's `src` or flashing the preview.
        setPreviewUrl(commentLayerRequested
          ? withArtifactCommentFlag(withArtifactVersion(url, cacheVersion))
          : withArtifactVersion(url, cacheVersion));
        // NOTE (ENG-931): we deliberately do NOT adopt the server's published
        // URL here anymore. usePublish's open refresh() already pulls the
        // authoritative published/access state from /artifacts/status for every
        // artifact type (including chat-bubble stubs). The old adoption fired
        // onChange({ ...artifact, publishedUrl }) from this async callback's
        // STALE closure (stale `artifact` lacking accessMode/accessEmails, and a
        // stale `!pub.publishedUrl` guard), which raced with refresh() and
        // clobbered the just-loaded restricted access list back to "public".
      })
      .catch((error) => { if (!cancelled) setErr(error?.message || 'Could not load artifact'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, artifact?.path, artifact?.mtime, actionPath, hasPreviewSource, disabledReason, draftPreviewUrl, isText, isImage, reloadNonce, commentLayerRequested]);

  // Parse CSV → GFM pipe table once per loaded text. We cap at
  // CSV_PREVIEW_ROW_LIMIT data rows to keep the markdown renderer
  // snappy on large files; the total row count is computed separately
  // so we can show a "showing N of M" notice.
  const csvPreview = useMemo(() => {
    if (!isText || textExt !== '.csv' || !textPreview?.content) return null;
    const rows = parseCsv(textPreview.content, CSV_PREVIEW_ROW_LIMIT);
    if (rows.length === 0) return null;
    const totalRows = Math.max(0, countCsvRows(textPreview.content) - 1);
    const shownRows = Math.max(0, rows.length - 1);
    return {
      markdown: csvRowsToGfmTable(rows),
      totalRows,
      shownRows,
      truncated: shownRows < totalRows,
    };
  }, [isText, textExt, textPreview?.content]);

  const onReload = useCallback(() => {
    if (!hasPreviewSource) return;
    setIframeReady(false);
    setReloadNonce((nonce) => nonce + 1);
  }, [hasPreviewSource]);

  return {
    draftPreviewUrl,
    previewUrl,
    previewDoc,
    previewKind,
    iframeReady,
    setIframeReady,
    textPreview,
    loading,
    backendPort,
    isText,
    textExt,
    isImage,
    imageSrc,
    imageFailed,
    csvPreview,
    onReload,
  };
}
