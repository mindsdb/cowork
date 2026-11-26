// The live page of an inline artifact (ENG-4684), shown in the body of its
// chat card: a small interactive chart or diagram the agent marked
// `display: "inline"`, read like an image in the reply rather than opened.
//
// Nothing here is a second preview pipeline. The page loads through the
// viewer's own loader (htmlPreviewSource.js), errors come from the viewer's
// diagnostics hook and button, the size and theme go over the viewer's shim
// channel (usePreviewFit's report check, usePreviewView's parent tag), and
// the lazy mount is the transcript's IntersectionObserver hook. What is its
// own is the frame's policy and its height:
//
//   - `sandbox="allow-scripts"` and nothing more, stricter than the viewer:
//     no popups, forms or modals from a page sitting in the middle of a reply.
//     Without allow-same-origin the shim also reports its size (it sends
//     `size` only where storage is blocked).
//   - As tall as the page reports, clamped. The shim's `content` for a page
//     that scrolls is never less than the frame, so the frame starts at the
//     floor and grows to what the page asks for.
//   - Mounted only near the viewport, and unmounted again far from it,
//     keeping its last height so the transcript does not jump.
//   - The page's state (`window.anton.setState`) is the artifact's
//     `state.json`, and its Submit a chat turn (useInlineArtifactState).
//
// With `revisionId` the frame shows that saved revision instead of the
// draft: an earlier chat card opened to see the page as it was then. That is
// a snapshot: no state of its own, and nothing it submits.

import { useEffect, useMemo, useRef, useState } from 'react';
import { loadHtmlPreview, loadHtmlRevision, usesDraftLink, withdrawDraftLinks } from './htmlPreviewSource';
import { useInlineArtifactState } from './useInlineArtifactState';
import { previewReportFrom, previewSize } from './usePreviewFit';
import { postPreviewTheme } from './usePreviewView';
import { usePreviewDiagnostics } from './usePreviewDiagnostics';
import { PreviewErrorsButton } from './PreviewErrorsButton';
import { PreviewPlaceholder } from './ArtifactViewerBody';
import { useIntersection } from '../../hooks/useIntersection';
import { useBodyTheme } from '../../hooks/useBodyTheme';
import { useDraftLinks } from '../../../lib/draftLinks';
import { draftLinkLifetimeMs } from '../../lib/draftLinkRules';

export const INLINE_MIN_HEIGHT = 160;
export const INLINE_MAX_HEIGHT = 640;
// The policy an inline frame gets: scripts, and nothing else.
export const INLINE_SANDBOX = 'allow-scripts';
// How far outside the viewport a frame mounts (and stays mounted).
const NEAR_VIEWPORT = '600px 0px';

/** The frame height for a reported page height, or null to keep the current one. */
export function clampInlineHeight(content) {
  const value = previewSize(content);
  if (!value) return null;
  return Math.min(INLINE_MAX_HEIGHT, Math.max(INLINE_MIN_HEIGHT, Math.ceil(value)));
}

export function ArtifactInlinePreview({ artifact, title = '', revisionId = '', onSubmit = null }) {
  const boxRef = useRef(null);
  const iframeRef = useRef(null);
  // Where IntersectionObserver is missing there is nothing to wait for.
  const [near, setNear] = useState(() => typeof IntersectionObserver === 'undefined');
  useIntersection(boxRef, setNear, { rootMargin: NEAR_VIEWPORT });
  const theme = useBodyTheme();
  const themeRef = useRef(theme);
  themeRef.current = theme;
  const draftLinkEnabled = usesDraftLink(artifact, useDraftLinks());

  const actionPath = artifact?.canonicalPath || artifact?.file_path || artifact?.path || '';
  const hasActionPath = !!actionPath && !artifact?.actionDisabledReason;
  // A changed file (mtime) or address is another page: load it again.
  const sourceKey = revisionId
    ? `revision|${revisionId}`
    : [actionPath, artifact?.draftUrl || '', artifact?.mtime || '', draftLinkEnabled].join('|');
  const [loaded, setLoaded] = useState(null); // { key, url, doc, staleAt }
  const [error, setError] = useState('');
  const [height, setHeight] = useState(INLINE_MIN_HEIGHT);
  const source = loaded && loaded.key === sourceKey ? loaded : null;

  useEffect(() => {
    if (!near) return undefined;
    // A signed draft link expires: a frame mounted again after that loads a
    // fresh one rather than a URL the draft host now refuses.
    if (source && !(source.staleAt && Date.now() >= source.staleAt)) return undefined;
    let cancelled = false;
    const reading = new AbortController();
    setError('');
    const loading = revisionId
      ? loadHtmlRevision({ artifact, revisionId, signal: reading.signal })
      : loadHtmlPreview({
        artifact,
        actionPath,
        hasActionPath,
        cacheVersion: String(artifact?.mtime || 0),
        draftLinkEnabled,
        signal: reading.signal,
      });
    loading
      .then((next) => {
        if (cancelled) return;
        setLoaded({
          key: sourceKey,
          url: next.doc ? '' : next.url,
          doc: next.doc,
          staleAt: next.expiresAt != null ? Date.now() + draftLinkLifetimeMs(next.expiresAt) : 0,
        });
      })
      .catch(async (e) => {
        if (cancelled) return;
        // Links off changes `draftLinkEnabled`, and with it the key: the
        // next run loads through srcdoc.
        if (e?.stage === 'draft-link' && await withdrawDraftLinks(e.cause)) return;
        if (!cancelled) setError(e?.message || '');
      });
    return () => { cancelled = true; reading.abort(); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [near, sourceKey, source]);

  const mounted = near && !!source && !error;
  const resetKey = source ? (source.url || source.doc) : '';

  // The viewer's diagnostics, so a broken chart says so here; opening it in
  // the viewer offers the repair.
  const diagnostics = usePreviewDiagnostics(iframeRef, { enabled: mounted, resetKey });
  useInlineArtifactState(iframeRef, artifact, { enabled: mounted && !revisionId, onSubmit });

  useEffect(() => {
    if (!mounted) return undefined;
    const onMessage = (event) => {
      const data = previewReportFrom(event, iframeRef.current);
      if (!data || data.type !== 'size') return;
      const next = clampInlineHeight(data.content);
      if (next) setHeight(next);
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [mounted]);

  // A theme switch reaches a page already loaded; a new load gets it onLoad.
  useEffect(() => {
    if (mounted) postPreviewTheme(iframeRef.current?.contentWindow, theme);
  }, [mounted, theme]);

  const frameStyle = useMemo(() => ({
    display: 'block', width: '100%', height: '100%', border: 0,
    background: 'transparent', colorScheme: theme,
  }), [theme]);

  return (
    <div
      ref={boxRef}
      className="artifact-inline-preview"
      data-testid="artifact-inline-preview"
      style={{ position: 'relative', height, overflow: 'hidden' }}
    >
      {mounted && (
        <iframe
          ref={iframeRef}
          title={title}
          src={source.url || undefined}
          srcDoc={source.doc || undefined}
          sandbox={INLINE_SANDBOX}
          onLoad={() => postPreviewTheme(iframeRef.current?.contentWindow, themeRef.current)}
          style={frameStyle}
        />
      )}
      {!mounted && !error && <PreviewPlaceholder />}
      {error && (
        <div
          role="alert"
          className="grid size-full place-items-center bg-surface-2 p-4 text-center font-body text-xs text-ink-3"
        >
          {error}
        </div>
      )}
      {mounted && (
        <div className="absolute right-2 top-2">
          <PreviewErrorsButton diagnostics={diagnostics} />
        </div>
      )}
    </div>
  );
}

export default ArtifactInlinePreview;
