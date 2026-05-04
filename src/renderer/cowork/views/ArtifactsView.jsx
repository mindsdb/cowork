// Artifacts grid — every artifact card surfaces its publish state
// inline. HTML artifacts open in the in-app iframe viewer (which has
// its own publish/unpublish controls); other types open in the OS.
//
// Published artifacts get an accent pill. The card actions row gives
// quick-fire publish, unpublish, copy URL, and open-published.

import { useState } from 'react';
import Ico from '../components/Icons';
import {
  openArtifact, revealArtifact,
  publishArtifact, unpublishArtifact,
} from '../api';
import { ArtifactViewer } from '../components/artifact';

const FONT_BODY    = "var(--font-body)";
const FONT_DISPLAY = "var(--font-display)";

function PageHeader({ title, subtitle }) {
  return (
    <div className="page-header">
      <div style={{ flex: 1 }}>
        <h2 className="page-title" style={{ fontFamily: FONT_DISPLAY }}>{title}</h2>
        {subtitle && (
          <div style={{ fontFamily: FONT_BODY, fontSize: 13, color: 'var(--ink-3)', marginTop: 4 }}>
            {subtitle}
          </div>
        )}
      </div>
    </div>
  );
}

function PublishedPill() {
  // Static badge — the URL row below handles the click-to-open
  // affordance, so the pill no longer doubles as a button.
  return (
    <span
      style={{
        background: 'color-mix(in srgb, var(--accent) 14%, transparent)',
        border: '1px solid color-mix(in srgb, var(--accent) 35%, transparent)',
        color: 'var(--accent)',
        padding: '3px 8px', borderRadius: 999,
        fontSize: 10.5, fontWeight: 600,
        display: 'inline-flex', alignItems: 'center', gap: 5,
        flexShrink: 0,
        letterSpacing: '0.04em', textTransform: 'uppercase',
        fontFamily: FONT_BODY,
      }}
    >
      <span style={{ width: 5, height: 5, borderRadius: 99, background: 'var(--accent)' }} />
      Published
    </span>
  );
}

// URL row — a compact, theme-aware pill that holds the public URL
// (truncated), an external-link affordance to open it in the browser,
// and a copy button. Sits directly under the title for published
// artifacts. Replaces the old Copy URL / Open URL buttons in the
// action row.
function PublishedUrlRow({ url, onOpen, onCopy }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = async (e) => {
    e.stopPropagation();
    await onCopy?.();
    setCopied(true);
    setTimeout(() => setCopied(false), 1400);
  };
  // Strip protocol for display only — keeps the pill short and the
  // user can still see the host + path clearly.
  const display = url.replace(/^https?:\/\//, '');
  return (
    <div
      style={{
        display: 'flex', alignItems: 'center', gap: 0,
        background: 'var(--surface-2)',
        border: '1px solid var(--line)',
        borderRadius: 8,
        overflow: 'hidden',
        minWidth: 0,
      }}
    >
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); onOpen?.(); }}
        title={`Open in browser: ${url}`}
        style={{
          flex: 1, minWidth: 0,
          display: 'inline-flex', alignItems: 'center', gap: 8,
          padding: '7px 10px',
          background: 'transparent', border: 0, cursor: 'pointer',
          font: 'inherit', fontFamily: FONT_BODY, fontSize: 12,
          color: 'var(--ink-2)', textAlign: 'left',
          transition: 'color 120ms ease, background 120ms ease',
        }}
        onMouseOver={(e) => {
          e.currentTarget.style.color = 'var(--accent)';
          e.currentTarget.style.background = 'color-mix(in srgb, var(--accent) 8%, transparent)';
        }}
        onMouseOut={(e) => {
          e.currentTarget.style.color = 'var(--ink-2)';
          e.currentTarget.style.background = 'transparent';
        }}
      >
        <span style={{ display: 'inline-flex', flexShrink: 0, color: 'var(--accent)' }}>
          {Ico.externalLink(13)}
        </span>
        <span style={{
          minWidth: 0, flex: 1,
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>
          {display}
        </span>
      </button>
      <button
        type="button"
        onClick={handleCopy}
        title={copied ? 'Copied' : 'Copy URL'}
        style={{
          flexShrink: 0,
          padding: '7px 10px',
          background: 'transparent',
          border: 0, borderLeft: '1px solid var(--line)',
          cursor: 'pointer', font: 'inherit',
          color: copied ? 'var(--accent)' : 'var(--ink-3)',
          display: 'inline-flex', alignItems: 'center',
          transition: 'color 120ms ease, background 120ms ease',
        }}
        onMouseOver={(e) => {
          if (!copied) e.currentTarget.style.color = 'var(--ink)';
          e.currentTarget.style.background = 'color-mix(in srgb, var(--accent) 8%, transparent)';
        }}
        onMouseOut={(e) => {
          e.currentTarget.style.color = copied ? 'var(--accent)' : 'var(--ink-3)';
          e.currentTarget.style.background = 'transparent';
        }}
      >
        {copied ? Ico.check(13) : Ico.copy(13)}
      </button>
    </div>
  );
}

function ActionButton({ children, onClick, danger, primary, title }) {
  const styleBase = {
    cursor: 'pointer', font: 'inherit',
    fontFamily: FONT_BODY, fontSize: 12, fontWeight: 500,
    padding: '6px 10px', borderRadius: 7,
    display: 'inline-flex', alignItems: 'center', gap: 5,
    transition: 'background 120ms ease, color 120ms ease, border-color 120ms ease',
  };
  if (primary) Object.assign(styleBase, {
    background: 'var(--accent)', color: '#fff', border: '1px solid var(--accent)',
  });
  else if (danger) Object.assign(styleBase, {
    background: 'transparent', color: 'var(--danger)',
    border: '1px solid color-mix(in srgb, var(--danger) 30%, transparent)',
  });
  else Object.assign(styleBase, {
    background: 'transparent', color: 'var(--ink-2)', border: '1px solid var(--line)',
  });
  return (
    <button
      type="button"
      onClick={(e) => { e.stopPropagation(); onClick?.(); }}
      title={title}
      style={styleBase}
    >
      {children}
    </button>
  );
}

function ArtifactBubble({ artifact, onOpenViewer, onChange }) {
  const [busy, setBusy] = useState(false);
  const isHtml = (artifact.ext || '').toLowerCase() === '.html'
    || (artifact.path || '').toLowerCase().endsWith('.html');
  const published = !!artifact.publishedUrl;

  const onCopyUrl = async () => {
    if (!published) return;
    try { await navigator.clipboard?.writeText?.(artifact.publishedUrl); } catch {}
  };
  const onOpenPublished = async () => {
    if (!published) return;
    try { await window.antontron?.openExternal?.(artifact.publishedUrl); } catch {
      window.open(artifact.publishedUrl, '_blank', 'noreferrer');
    }
  };
  const onPublish = async () => {
    if (busy || !isHtml) return;
    setBusy(true);
    try {
      const r = await publishArtifact(artifact.path);
      if (r?.url) onChange?.({ ...artifact, publishedUrl: r.url });
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error('[publish] failed', e);
    } finally { setBusy(false); }
  };
  const onUnpublish = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await unpublishArtifact(artifact.path);
      onChange?.({ ...artifact, publishedUrl: '' });
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error('[unpublish] failed', e);
    } finally { setBusy(false); }
  };

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => isHtml ? onOpenViewer(artifact) : openArtifact(artifact.path)}
      onKeyDown={(e) => { if (e.key === 'Enter') (isHtml ? onOpenViewer(artifact) : openArtifact(artifact.path)); }}
      style={{
        cursor: 'pointer',
        background: 'var(--surface)',
        border: '1px solid var(--line)',
        borderRadius: 12, overflow: 'hidden',
        transition: 'border-color 160ms ease, box-shadow 200ms ease, transform 160ms ease',
        boxShadow: '0 1px 0 rgba(15,16,17,0.02)',
      }}
      onMouseOver={(e) => {
        e.currentTarget.style.borderColor = 'var(--accent)';
        e.currentTarget.style.boxShadow = '0 1px 0 rgba(15,16,17,0.02), 0 12px 28px rgba(15,16,17,0.08)';
        e.currentTarget.style.transform = 'translateY(-1px)';
      }}
      onMouseOut={(e) => {
        e.currentTarget.style.borderColor = 'var(--line)';
        e.currentTarget.style.boxShadow = '0 1px 0 rgba(15,16,17,0.02)';
        e.currentTarget.style.transform = 'translateY(0)';
      }}
    >
      <div style={{
        height: 96, background: artifact.bg || 'var(--surface-2)',
        display: 'flex', alignItems: 'flex-end', padding: 12,
        borderBottom: '1px solid var(--line)',
        fontFamily: FONT_BODY, fontSize: 10.5,
        color: 'var(--ink-3)', whiteSpace: 'pre', overflow: 'hidden',
      }}>
        {artifact.snippet}
      </div>
      <div style={{ padding: 14, display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
          <span style={{
            fontFamily: FONT_DISPLAY, fontSize: 14, fontWeight: 600,
            color: 'var(--ink)', flex: 1, minWidth: 0,
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}>{artifact.title}</span>
          {published && <PublishedPill />}
          {!published && artifact.live && (
            <span style={{
              display: 'inline-flex', alignItems: 'center', gap: 5,
              fontFamily: FONT_BODY, fontSize: 11, color: 'var(--accent)', fontWeight: 500,
            }}>
              <span className="pulse-dot" style={{
                width: 6, height: 6, borderRadius: '50%', background: 'var(--accent)',
              }} />
              Live
            </span>
          )}
        </div>

        {/* Published URL row — sits right under the title so the
            link is the most visible secondary affordance. Replaces
            the older Copy URL / Open URL action buttons. */}
        {published && (
          <PublishedUrlRow
            url={artifact.publishedUrl}
            onOpen={onOpenPublished}
            onCopy={onCopyUrl}
          />
        )}

        <div style={{
          fontFamily: FONT_BODY, fontSize: 12, color: 'var(--ink-4)',
        }}>
          {artifact.kind} · {artifact.updated}
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {published ? (
            <ActionButton onClick={onUnpublish} danger title="Unpublish from Minds">
              {busy ? 'Working…' : 'Unpublish'}
            </ActionButton>
          ) : isHtml ? (
            <ActionButton onClick={onPublish} primary title="Publish to Minds">
              {busy ? 'Publishing…' : 'Publish'}
            </ActionButton>
          ) : null}
          <ActionButton onClick={() => openArtifact(artifact.path)} title="Open file">Open</ActionButton>
          <ActionButton onClick={() => revealArtifact(artifact.path)} title="Reveal in Finder">Reveal</ActionButton>
        </div>
      </div>
    </div>
  );
}

export default function ArtifactsView({ artifacts: initial = [] }) {
  // Local mirror so publish/unpublish updates the card without
  // re-fetching the whole list.
  const [list, setList] = useState(initial);
  const [viewer, setViewer] = useState(null);

  // Reflect prop changes (parent may refresh on stream completion).
  if (list !== initial && list.length === 0 && initial.length > 0) {
    // first hydration after mount — accept the prop
    setList(initial);
  }

  const updateOne = (updated) => {
    setList((prev) => prev.map((a) => a.path === updated.path ? { ...a, ...updated } : a));
    setViewer((cur) => (cur && cur.path === updated.path ? { ...cur, ...updated } : cur));
  };

  return (
    <div className="scroll-clean" style={{ flex: 1, overflowY: 'auto' }}>
      <PageHeader
        title="Live artifacts"
        subtitle="Documents, dashboards, and code Anton produces. Publish HTML to share a live URL."
      />

      {(list && list.length === 0) ? (
        <div style={{ padding: '60px 32px', textAlign: 'center', color: 'var(--ink-3)' }}>
          <div style={{ display: 'inline-flex', color: 'var(--ink-5)', marginBottom: 12 }}>{Ico.sparkle(32)}</div>
          <div style={{ fontFamily: FONT_DISPLAY, fontSize: 15, fontWeight: 600, color: 'var(--ink)', marginBottom: 6 }}>
            No artifacts yet
          </div>
          <div style={{ fontFamily: FONT_BODY, fontSize: 13 }}>
            When Anton creates documents, dashboards, or code outputs they'll appear here.
          </div>
        </div>
      ) : (
        <div style={{
          padding: 28,
          display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))',
          gap: 14,
        }}>
          {(list || []).map((a) => (
            <ArtifactBubble
              key={a.id}
              artifact={a}
              onOpenViewer={setViewer}
              onChange={updateOne}
            />
          ))}
        </div>
      )}

      <ArtifactViewer
        open={!!viewer}
        artifact={viewer}
        onClose={() => setViewer(null)}
        onChange={updateOne}
      />
    </div>
  );
}
