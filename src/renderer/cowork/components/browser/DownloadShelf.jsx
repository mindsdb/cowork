import { useEffect, useRef, useState } from 'react';
import Ico from '../Icons';
import { Tooltip } from '../ui';
// Namespace import + typeof guards — see useBrowserState.js.
import * as host from '../../../platform/host';

function fmtBytes(n) {
  if (!n || n <= 0) return '';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

function statusOf(d) {
  if (d.state === 'completed') return fmtBytes(d.receivedBytes) || 'Done';
  if (d.state === 'cancelled') return 'Cancelled';
  if (d.state === 'interrupted') return 'Failed';
  if (d.totalBytes > 0) return `${Math.round((d.receivedBytes / d.totalBytes) * 100)}%`;
  return fmtBytes(d.receivedBytes) || '…';
}

// The downloads button + shelf. Main tracks the session partition's
// will-download items into the state push; this is presentation only.
// Click a row → reveal in Finder/Explorer. The shelf overlays the native
// view, so the parent hides it via onToggle (same rule as the omnibox).
export default function DownloadShelf({ downloads = [], onToggle }) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef(null);
  const progressing = downloads.some((d) => d.state === 'progressing');

  const setOpenWithParent = (next) => {
    setOpen(next);
    onToggle?.(next);
  };

  // Click-away close (the shelf is a popover, not a modal).
  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpenWithParent(false);
    };
    const onKey = (e) => { if (e.key === 'Escape') setOpenWithParent(false); };
    window.addEventListener('mousedown', onDown, true);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', onDown, true);
      window.removeEventListener('keydown', onKey);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  return (
    <div ref={wrapRef} style={{ position: 'relative', flex: '0 0 auto' }}>
      <Tooltip content={downloads.length ? 'Downloads' : 'No downloads yet'} delay={250}>
        <button
          type="button"
          className={`icon-btn${open ? ' active' : ''}`}
          aria-label="Downloads"
          aria-expanded={open}
          style={{ position: 'relative' }}
          onClick={() => setOpenWithParent(!open)}
        >
          {Ico.download(15)}
          {progressing && (
            <span
              aria-label="Download in progress"
              style={{
                position: 'absolute', right: 3, bottom: 3,
                width: 6, height: 6, borderRadius: '50%',
                background: 'var(--accent)',
              }}
            />
          )}
        </button>
      </Tooltip>

      {open && (
        <div
          role="dialog"
          aria-label="Downloads"
          style={{
            position: 'absolute', top: 'calc(100% + 8px)', right: 0, zIndex: 40,
            width: 300, maxHeight: 320, overflowY: 'auto',
            background: 'var(--surface)', border: '1px solid var(--line)',
            borderRadius: 'var(--r-lg, 10px)',
            boxShadow: 'var(--sh-popup, 0 8px 24px rgba(15,16,17,.14))',
            padding: 6,
          }}
        >
          {downloads.length === 0 && (
            <div style={{ padding: '14px 10px', fontSize: 12.5, color: 'var(--ink-4)', textAlign: 'center' }}>
              Files you download in the browser appear here.
            </div>
          )}
          {downloads.map((d) => (
            <button
              key={d.id}
              type="button"
              onClick={() => { host.showItemInFolder?.(d.savePath); setOpenWithParent(false); }}
              title={`${d.savePath} — show in folder`}
              style={{
                display: 'flex', alignItems: 'center', gap: 10,
                width: '100%', padding: '7px 8px', border: 0, borderRadius: 6,
                background: 'transparent', cursor: 'pointer', textAlign: 'left',
                fontFamily: 'var(--font-body)',
              }}
              onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--surface-2)'; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
            >
              <span style={{ display: 'inline-flex', flex: '0 0 auto', color: d.state === 'completed' ? 'var(--ok)' : d.state === 'progressing' ? 'var(--accent)' : 'var(--ink-4)' }}>
                {d.state === 'completed' ? Ico.check?.(14) ?? Ico.download(14) : Ico.download(14)}
              </span>
              <span style={{ flex: 1, minWidth: 0 }}>
                <span style={{
                  display: 'block', fontSize: 12.5, color: 'var(--ink)',
                  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                }}>
                  {d.filename}
                </span>
                <span style={{ display: 'block', fontSize: 11, color: 'var(--ink-4)', marginTop: 1 }}>
                  {statusOf(d)}
                </span>
              </span>
              {d.state === 'progressing' && d.totalBytes > 0 && (
                <span style={{
                  flex: '0 0 auto', width: 48, height: 3, borderRadius: 2,
                  background: 'var(--surface-3)', overflow: 'hidden',
                }}>
                  <span style={{
                    display: 'block', height: '100%',
                    width: `${Math.round((d.receivedBytes / d.totalBytes) * 100)}%`,
                    background: 'var(--accent)',
                  }} />
                </span>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
