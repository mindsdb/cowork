// Inline preview modal for HTML artifacts. Renders the artifact's
// content in a sandboxed iframe (via srcdoc so we don't need to
// expose a file:// URL). Top bar has the title, a "Published" pill
// when the artifact has a live URL, plus Publish / Unpublish / Open
// in OS actions.

import { useEffect, useRef, useState } from 'react';
import Ico from '../Icons';
import { mountArtifactPreview, publishArtifact, unpublishArtifact } from '../../api';
import { copyText } from '../../lib/clipboard';

const FONT_BODY = "'Inter', system-ui, sans-serif";
const FONT_DISPLAY = "'Josefin Sans', sans-serif";
const FONT_MONO = "'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, monospace";

// Single-row "label: value [copy]" — used twice in the header (local
// path + remote URL when published). Tiny inline copy state flips the
// glyph to a check for ~1.4s after a successful copy.
function PathRow({ label, value, accent = false }) {
  const [copied, setCopied] = useState(false);
  if (!value) return null;
  const onCopy = async (e) => {
    e.stopPropagation();
    // Use the shared helper so the execCommand fallback kicks in when
    // `navigator.clipboard.writeText` is unavailable / blocked. Only
    // flip the icon to "copied" if the copy actually succeeded —
    // otherwise the check was misleading users into thinking it worked.
    const ok = await copyText(value);
    if (ok) {
      setCopied(true);
      setTimeout(() => setCopied(false), 1400);
    }
  };
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 6, minWidth: 0,
      fontFamily: FONT_MONO, fontSize: 10.5,
    }}>
      <span style={{
        flexShrink: 0,
        color: 'var(--ink-4)', letterSpacing: '0.04em',
        textTransform: 'uppercase',
      }}>{label}:</span>
      <span title={value} style={{
        minWidth: 0, flex: 1,
        color: accent ? 'var(--accent)' : 'var(--ink-3)',
        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
      }}>
        {value}
      </span>
      <button
        type="button"
        onClick={onCopy}
        title={copied ? 'Copied' : `Copy ${label}`}
        aria-label={copied ? 'Copied' : `Copy ${label}`}
        style={{
          flexShrink: 0,
          width: 20, height: 20, borderRadius: 4,
          background: 'transparent', border: 0,
          cursor: 'pointer',
          color: copied ? 'var(--accent)' : 'var(--ink-4)',
          display: 'inline-grid', placeItems: 'center',
          transition: 'color 120ms ease, background 120ms ease',
        }}
        onMouseOver={(e) => {
          if (!copied) e.currentTarget.style.color = 'var(--ink-2)';
          e.currentTarget.style.background = 'var(--surface-2)';
        }}
        onMouseOut={(e) => {
          e.currentTarget.style.color = copied ? 'var(--accent)' : 'var(--ink-4)';
          e.currentTarget.style.background = 'transparent';
        }}
      >
        {copied ? Ico.check(11) : Ico.copy(11)}
      </button>
    </div>
  );
}

// Small popover anchored to the kebab. Lives inside the modal so its
// fixed-positioned chrome stacks correctly against the modal backdrop.
function ActionsPopover({ open, anchorRect, onClose, items }) {
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e) => {
      if (!ref.current?.contains(e.target)) onClose?.();
    };
    const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); onClose?.(); } };
    window.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey, true);
    return () => {
      window.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey, true);
    };
  }, [open, onClose]);

  if (!open || !anchorRect) return null;

  const MENU_W = 200;
  const VW = typeof window !== 'undefined' ? window.innerWidth : 1200;
  const left = Math.min(VW - MENU_W - 8, Math.max(8, anchorRect.right - MENU_W));
  const top = anchorRect.bottom + 6;

  return (
    <div
      ref={ref}
      onMouseDown={(e) => e.stopPropagation()}
      style={{
        position: 'fixed', top, left, zIndex: 90, width: MENU_W,
        background: 'var(--surface)',
        border: '1px solid var(--line)',
        borderRadius: 10,
        boxShadow: '0 12px 32px rgba(15,16,17,0.28)',
        padding: '4px 0',
      }}
    >
      {items.map((it, i) =>
        it.divider ? (
          <div key={`d-${i}`} style={{ height: 1, background: 'var(--line)', margin: '4px 0' }} />
        ) : (
          <button
            key={it.label}
            type="button"
            disabled={it.disabled}
            onClick={(e) => { e.stopPropagation(); it.onClick?.(); onClose?.(); }}
            style={{
              width: 'calc(100% - 8px)', margin: '0 4px',
              display: 'flex', alignItems: 'center', gap: 10,
              padding: '8px 10px', borderRadius: 5,
              background: 'transparent', border: 0,
              fontFamily: FONT_BODY, fontSize: 13,
              color: it.danger ? 'var(--danger)' : 'var(--ink-2)',
              textAlign: 'left',
              cursor: it.disabled ? 'not-allowed' : 'pointer',
              opacity: it.disabled ? 0.55 : 1,
            }}
            onMouseOver={(e) => {
              if (it.disabled) return;
              e.currentTarget.style.background = it.danger
                ? 'color-mix(in srgb, var(--danger) 12%, transparent)'
                : 'var(--surface-2)';
            }}
            onMouseOut={(e) => { e.currentTarget.style.background = 'transparent'; }}
          >
            {it.icon && (
              <span style={{
                display: 'inline-flex', flexShrink: 0,
                color: it.danger ? 'var(--danger)' : 'var(--ink-3)',
              }}>{it.icon}</span>
            )}
            <span style={{ flex: 1 }}>{it.label}</span>
          </button>
        ),
      )}
    </div>
  );
}

export function ArtifactViewer({ open, artifact, onClose, onChange, onDelete }) {
  // Mounted preview URL — iframe loads this with `src=` so relative
  // `<script>` / `<link>` refs in the HTML resolve against a real URL.
  // (srcdoc has no base URL → relative refs 404.)
  const [previewUrl, setPreviewUrl] = useState('');
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState('');
  const [publishedUrl, setPublishedUrl] = useState(artifact?.publishedUrl || '');
  const [busy, setBusy] = useState(false);
  const [menuRect, setMenuRect] = useState(null);
  const kebabRef = useRef(null);

  // Refresh state when the artifact changes (e.g. user opens a
  // different one without closing first).
  useEffect(() => {
    setPublishedUrl(artifact?.publishedUrl || '');
  }, [artifact?.path, artifact?.publishedUrl]);

  // Esc closes.
  useEffect(() => {
    if (!open) return;
    const onKey = (e) => { if (e.key === 'Escape') onClose?.(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  // Mount the artifact when opened. The server registers the parent
  // dir under a token and returns a URL that serves the entry HTML;
  // assets at sibling paths resolve naturally because they share the
  // same URL prefix.
  useEffect(() => {
    if (!open || !artifact?.path) return;
    setLoading(true);
    setErr('');
    setPreviewUrl('');
    mountArtifactPreview(artifact.path)
      .then(({ url }) => {
        if (!url) throw new Error('Preview mount returned no URL');
        setPreviewUrl(url);
      })
      .catch((e) => setErr(e?.message || 'Could not load artifact'))
      .finally(() => setLoading(false));
  }, [open, artifact?.path]);

  if (!open || !artifact) return null;

  const onPublish = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const r = await publishArtifact(artifact.path);
      if (r?.url) {
        setPublishedUrl(r.url);
        onChange?.({ ...artifact, publishedUrl: r.url });
      }
    } catch (e) {
      setErr(e?.message || 'Publish failed');
    } finally {
      setBusy(false);
    }
  };
  const onUnpublish = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await unpublishArtifact(artifact.path);
      setPublishedUrl('');
      onChange?.({ ...artifact, publishedUrl: '' });
    } catch (e) {
      setErr(e?.message || 'Unpublish failed');
    } finally {
      setBusy(false);
    }
  };
  const onOpenOS = async () => {
    try { await window.antontron?.openPath?.(artifact.path); } catch {}
  };
  const onTrash = async () => {
    if (busy) return;
    // No confirmation modal — `shell.trashItem` is recoverable from the
    // user's Trash, so a click is reversible. The viewer closes once
    // the file is gone so we don't leave a dead preview on screen.
    setBusy(true);
    setErr('');
    try {
      const result = await window.antontron?.trashItem?.(artifact.path);
      if (result && result.ok === false) {
        throw new Error(result.reason || 'Could not move to Trash.');
      }
      onDelete?.(artifact.path);
      onClose?.();
    } catch (e) {
      setErr(e?.message || 'Delete failed');
    } finally {
      setBusy(false);
    }
  };
  const onOpenPublished = async () => {
    if (!publishedUrl) return;
    try { await window.antontron?.openExternal?.(publishedUrl); } catch {
      window.open(publishedUrl, '_blank', 'noreferrer');
    }
  };

  return (
    <div
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose?.(); }}
      style={{
        position: 'fixed', inset: 0, zIndex: 80,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: 'rgba(0,0,0,0.45)',
        backdropFilter: 'blur(2px)',
        WebkitBackdropFilter: 'blur(2px)',
        WebkitAppRegion: 'no-drag',
      }}
    >
      <div
        style={{
          width: 'min(1080px, 94vw)', height: 'min(820px, 88vh)',
          background: 'var(--surface)',
          border: '1px solid var(--line)',
          borderRadius: 14,
          boxShadow: '0 24px 60px rgba(15,16,17,0.30)',
          display: 'flex', flexDirection: 'column', overflow: 'hidden',
          fontFamily: FONT_BODY,
        }}
        onMouseDown={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div style={{
          flex: '0 0 auto',
          display: 'flex', alignItems: 'center', gap: 12,
          padding: '12px 16px',
          borderBottom: '1px solid var(--line)',
        }}>
          <span style={{ display: 'inline-flex', color: 'var(--accent)', flexShrink: 0 }}>
            {Ico.doc(18)}
          </span>
          <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
            <div style={{
              fontFamily: FONT_DISPLAY, fontWeight: 600, fontSize: 15,
              color: 'var(--ink)',
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            }}>
              {artifact.title || artifact.path?.split('/').pop()}
            </div>
            <PathRow label="local" value={artifact.path} />
            {publishedUrl && (
              <PathRow label="remote" value={publishedUrl} accent />
            )}
          </div>
          {publishedUrl && (
            <button
              type="button"
              onClick={onOpenPublished}
              title={`Open published URL in browser: ${publishedUrl}`}
              style={{
                cursor: 'pointer',
                background: 'color-mix(in srgb, var(--accent) 14%, transparent)',
                border: '1px solid color-mix(in srgb, var(--accent) 35%, transparent)',
                color: 'var(--accent)',
                padding: '4px 10px', borderRadius: 999,
                fontSize: 11.5, fontWeight: 600,
                display: 'inline-flex', alignItems: 'center', gap: 6,
                flexShrink: 0,
              }}
            >
              <span style={{ width: 6, height: 6, borderRadius: 99, background: 'var(--accent)' }} />
              <span>Published</span>
              {/* External-link glyph signals "click → opens in browser",
                  matching the URL pill convention on the artifact card. */}
              <span style={{ display: 'inline-flex', marginLeft: 1 }}>
                {Ico.externalLink(11)}
              </span>
            </button>
          )}
          {publishedUrl ? (
            <button
              type="button"
              onClick={onUnpublish}
              disabled={busy}
              title="Unpublish"
              style={{
                cursor: busy ? 'progress' : 'pointer',
                background: 'transparent',
                border: '1px solid var(--line)',
                color: 'var(--ink-2)',
                padding: '6px 12px', borderRadius: 8,
                fontSize: 12.5, fontWeight: 500,
                opacity: busy ? 0.6 : 1,
              }}
            >
              Unpublish
            </button>
          ) : (
            <button
              type="button"
              onClick={onPublish}
              disabled={busy}
              title="Publish"
              style={{
                cursor: busy ? 'progress' : 'pointer',
                background: 'var(--accent)', border: '1px solid var(--accent)',
                color: '#fff',
                padding: '6px 12px', borderRadius: 8,
                fontSize: 12.5, fontWeight: 600,
                opacity: busy ? 0.7 : 1,
              }}
            >
              {busy ? 'Publishing…' : 'Publish'}
            </button>
          )}
          <button
            ref={kebabRef}
            type="button"
            aria-label="More actions"
            title="More actions"
            onClick={(e) => {
              e.stopPropagation();
              setMenuRect(menuRect ? null : kebabRef.current?.getBoundingClientRect() || null);
            }}
            style={{
              cursor: 'pointer',
              background: menuRect ? 'var(--surface-2)' : 'transparent',
              border: '1px solid var(--line)',
              color: 'var(--ink-2)',
              width: 32, height: 30, borderRadius: 8,
              display: 'inline-grid', placeItems: 'center',
              transition: 'background .12s ease, color .12s ease',
            }}
            onMouseOver={(e) => { e.currentTarget.style.background = 'var(--surface-2)'; e.currentTarget.style.color = 'var(--ink)'; }}
            onMouseOut={(e) => { e.currentTarget.style.background = menuRect ? 'var(--surface-2)' : 'transparent'; e.currentTarget.style.color = 'var(--ink-2)'; }}
          >
            {Ico.moreVert(15)}
          </button>
          <button
            type="button"
            onClick={onClose}
            title="Close"
            style={{
              cursor: 'pointer',
              background: 'transparent', border: 0,
              color: 'var(--ink-3)',
              width: 28, height: 28, borderRadius: 6,
              display: 'inline-grid', placeItems: 'center',
              fontSize: 18, lineHeight: 1,
            }}
          >×</button>
        </div>

        <ActionsPopover
          open={!!menuRect}
          anchorRect={menuRect}
          onClose={() => setMenuRect(null)}
          items={[
            {
              label: 'Open in OS',
              icon: Ico.externalLink(13),
              onClick: onOpenOS,
            },
            {
              label: publishedUrl ? 'Unpublish' : 'Publish',
              icon: Ico.upload(13),
              disabled: busy,
              onClick: publishedUrl ? onUnpublish : onPublish,
            },
            { divider: true },
            {
              label: 'Delete',
              icon: Ico.trash(13),
              danger: true,
              disabled: busy,
              onClick: onTrash,
            },
          ]}
        />

        {/* Body — iframe with srcdoc, sandbox just enough to render
            ECharts/Chart.js etc. but not touch the parent app. */}
        <div style={{ flex: 1, minHeight: 0, background: 'var(--surface-2)' }}>
          {err ? (
            <div style={{ padding: 28, color: 'var(--danger)', fontSize: 13 }}>{err}</div>
          ) : loading ? (
            <div style={{ padding: 28, color: 'var(--ink-3)', fontSize: 13 }}>Loading preview…</div>
          ) : (
            // src= (not srcdoc) so relative asset refs resolve against
            // the served URL. We deliberately drop `allow-same-origin`
            // — the iframe shares the FastAPI origin otherwise, which
            // would let a hostile artifact's JS hit /v1/sessions etc.
            // Without same-origin, the iframe can still load its own
            // assets (script/link/img tags work), but fetch() back to
            // the API is CORS-blocked. Good tradeoff.
            previewUrl ? (
              <iframe
                title={artifact.title || 'Artifact preview'}
                src={previewUrl}
                sandbox="allow-scripts allow-popups allow-forms allow-modals"
                style={{ width: '100%', height: '100%', border: 0, background: '#fff' }}
              />
            ) : null
          )}
        </div>
      </div>
    </div>
  );
}
