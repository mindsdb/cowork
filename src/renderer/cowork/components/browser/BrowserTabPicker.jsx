// Tab picker modal — the user approves exactly ONE Chrome tab per task.
// Lists open tabs (title + host-only domain), single-select radio rows, and a
// domain-scope echo so the approved scope is explicit. Confirm -> onConfirm(targetId).
// role="dialog" + aria-modal, Esc / backdrop dismiss, focus trap on the dialog.
// See /code/.plans/designs/browser-control-tab-picker-*.html.

import { useEffect, useRef, useState } from 'react';

// Exported: the post-approval confirmation (ConnectWorkflowView) renders the
// same initial-letter avatar for the approved tab.
export function initialLetter(title, domain) {
  const source = (title || domain || '?').trim();
  return source.charAt(0).toUpperCase() || '?';
}

// "Try again" — re-runs the tab listing without closing the picker. Rendered
// in BOTH the empty state (no tabs in the dedicated window) and the error
// state (the listing itself failed).
function RetryButton({ onRetry }) {
  return (
    <div style={{ marginTop: 10 }}>
      <button
        type="button"
        onClick={onRetry}
        style={{
          all: 'unset', cursor: 'pointer',
          padding: '7px 12px', borderRadius: 8,
          border: '1px solid var(--line)',
          fontSize: 12.5, fontWeight: 500, color: 'var(--ink-2)',
        }}
      >
        Try again
      </button>
    </div>
  );
}

export default function BrowserTabPicker({ open, tabs = [], loading = false, error = '', onConfirm, onRetry, onClose }) {
  const [selectedId, setSelectedId] = useState(null);
  const dialogRef = useRef(null);

  // Reset selection whenever the picker (re)opens.
  useEffect(() => {
    if (open) setSelectedId(null);
  }, [open]);

  // Esc closes; Tab is trapped within the dialog (focus cannot escape to the
  // page behind the modal); focus the dialog on open for keyboard users / SR.
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose?.();
        return;
      }
      if (e.key !== 'Tab') return;
      const root = dialogRef.current;
      if (!root) return;
      const focusable = Array.from(
        root.querySelectorAll(
          'button:not([disabled]), [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
        ),
      ).filter((el) => el.offsetParent !== null || el === root);
      if (focusable.length === 0) {
        e.preventDefault();
        root.focus();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement;
      if (e.shiftKey) {
        if (active === first || active === root) {
          e.preventDefault();
          last.focus();
        }
      } else if (active === last) {
        e.preventDefault();
        first.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    dialogRef.current?.focus();
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  const selectedTab = tabs.find((t) => t.targetId === selectedId) || null;
  const canConfirm = Boolean(selectedTab);

  return (
    <div
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose?.(); }}
      style={{
        position: 'fixed', inset: 0, zIndex: 80,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: 'rgba(14,15,16,0.34)',
        backdropFilter: 'blur(2px)', WebkitBackdropFilter: 'blur(2px)',
        WebkitAppRegion: 'no-drag',
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="browser-tab-picker-title"
        tabIndex={-1}
        onMouseDown={(e) => e.stopPropagation()}
        style={{
          width: 'min(460px, 92vw)',
          background: 'var(--surface)',
          border: '1px solid var(--line)',
          borderRadius: 12,
          boxShadow: '0 24px 60px rgba(15,16,17,0.25), 0 1px 0 rgba(15,16,17,0.04)',
          padding: '20px 22px 16px',
          fontFamily: "'Inter', sans-serif",
          outline: 'none',
        }}
      >
        <div
          id="browser-tab-picker-title"
          style={{
            fontFamily: "'Josefin Sans', sans-serif",
            fontSize: 16, fontWeight: 600, color: 'var(--ink)', letterSpacing: '0.01em',
          }}
        >
          Choose a Chrome tab
        </div>
        <div style={{ marginTop: 6, fontSize: 12.5, lineHeight: 1.5, color: 'var(--ink-3)' }}>
          These tabs are in Cowork&apos;s dedicated Chrome window. You can also just ask the agent to open a site once connected.
        </div>
        <div style={{ marginTop: 8, fontSize: 13, lineHeight: 1.5, color: 'var(--ink-2)' }}>
          Cowork will get read-only access to the one tab you pick — nothing else in your browser.
        </div>

        <div
          role="radiogroup"
          aria-label="Open Chrome tabs"
          style={{ marginTop: 14, display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 320, overflowY: 'auto' }}
        >
          {loading ? (
            <div style={{ padding: '18px 4px', fontSize: 13, color: 'var(--ink-3)' }}>
              Looking for open Chrome tabs…
            </div>
          ) : tabs.length === 0 ? (
            // Empty-but-ok: the dedicated window really has no tabs. When the
            // listing FAILED the error box below carries the reason (and its
            // own Try again) — don't also show this misleading copy.
            !error && (
              <div style={{ padding: '18px 4px', fontSize: 13, color: 'var(--ink-3)' }}>
                No open tabs in Cowork&apos;s Chrome window. It may be behind this window — open a
                page there, or hit Try again.
                {onRetry && <RetryButton onRetry={onRetry} />}
              </div>
            )
          ) : (
            tabs.map((tab) => {
              const selected = tab.targetId === selectedId;
              return (
                <button
                  key={tab.targetId}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  onClick={() => setSelectedId(tab.targetId)}
                  style={{
                    all: 'unset', cursor: 'pointer',
                    display: 'flex', alignItems: 'center', gap: 10,
                    padding: '9px 10px', borderRadius: 8,
                    border: `1px solid ${selected ? 'var(--accent)' : 'var(--line)'}`,
                    background: selected ? 'var(--accent-bg)' : 'transparent',
                  }}
                >
                  <span
                    aria-hidden="true"
                    style={{
                      width: 26, height: 26, flex: '0 0 auto', borderRadius: 6,
                      display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                      background: 'var(--surface-2)', color: 'var(--ink-2)',
                      fontSize: 12, fontWeight: 700,
                    }}
                  >
                    {initialLetter(tab.title, tab.domain)}
                  </span>
                  <span style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
                    <span style={{
                      fontSize: 13, fontWeight: 500, color: 'var(--ink)',
                      overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                    }}>
                      {tab.title || tab.domain || 'Untitled tab'}
                    </span>
                    <span style={{
                      fontSize: 11.5, color: 'var(--ink-3)',
                      overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                    }}>
                      {tab.domain}
                    </span>
                  </span>
                </button>
              );
            })
          )}
        </div>

        {selectedTab && (
          <div style={{
            marginTop: 12, padding: '9px 11px', borderRadius: 8,
            background: 'var(--accent-bg)', fontSize: 12.5, lineHeight: 1.5, color: 'var(--ink-2)',
          }}>
            Cowork will be able to read <strong style={{ color: 'var(--ink)' }}>{selectedTab.domain}</strong>. Only
            pages on this domain, and only while the task runs. Approval ends when you disconnect.
          </div>
        )}

        {error && (
          <div
            role="alert"
            data-testid="browser-tab-picker-error"
            style={{
              marginTop: 12, padding: '9px 11px', borderRadius: 8,
              background: 'color-mix(in srgb, var(--danger, #d9534f) 8%, transparent)',
              border: '1px solid color-mix(in srgb, var(--danger, #d9534f) 30%, transparent)',
              fontSize: 12.5, lineHeight: 1.5, color: 'var(--danger, #d9534f)',
            }}
          >
            {error}
            {onRetry && <RetryButton onRetry={onRetry} />}
          </div>
        )}

        <div style={{ marginTop: 16, display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button
            type="button"
            onClick={onClose}
            style={{
              all: 'unset', cursor: 'pointer',
              padding: '8px 14px', borderRadius: 8,
              border: '1px solid var(--line)',
              fontSize: 13, fontWeight: 500, color: 'var(--ink-2)', background: 'transparent',
            }}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => { if (canConfirm) onConfirm?.(selectedTab.targetId); }}
            disabled={!canConfirm}
            style={{
              all: 'unset', cursor: canConfirm ? 'pointer' : 'default',
              padding: '8px 14px', borderRadius: 8,
              fontSize: 13, fontWeight: 600, color: '#fff',
              background: 'var(--accent)', border: '1px solid var(--accent)',
              opacity: canConfirm ? 1 : 0.5,
            }}
          >
            Approve this tab
          </button>
        </div>
      </div>
    </div>
  );
}
