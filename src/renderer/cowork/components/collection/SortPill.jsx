// Pill-shaped dropdown for sort options. Each consumer supplies its
// own `options` list ([{id, label}]); the kit doesn't try to canonical
// across views because the actual sort keys vary (Projects uses
// recent/name/most-active; Artifacts uses newest/name; Scheduled uses
// next-run/name; Connect Apps uses recent/name).
//
// Click-outside + Escape close the menu, matching every other popover
// in the app.

import { useEffect, useRef, useState } from 'react';
import Ico from '../Icons';

const FONT_BODY = 'var(--font-body)';

export function SortPill({ value, onChange, options = [], label = 'Sort' }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return;
    const onClick = (e) => { if (!ref.current?.contains(e.target)) setOpen(false); };
    const onKey   = (e) => { if (e.key === 'Escape') setOpen(false); };
    window.addEventListener('mousedown', onClick);
    window.addEventListener('keydown',   onKey);
    return () => {
      window.removeEventListener('mousedown', onClick);
      window.removeEventListener('keydown',   onKey);
    };
  }, [open]);

  const current = options.find((o) => o.id === value) || options[0] || { label: '—' };

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        style={{
          display: 'inline-flex', alignItems: 'center', gap: 6,
          padding: '7px 11px', borderRadius: 7,
          background: 'var(--surface-2)',
          border: '1px solid var(--line)',
          color: 'var(--ink-2)',
          fontFamily: FONT_BODY, fontSize: 12.5,
          cursor: 'pointer',
        }}
      >
        <span style={{ color: 'var(--ink-4)', fontSize: 11.5 }}>{label}:</span>
        <span>{current.label}</span>
        <span style={{ display: 'inline-flex', color: 'var(--ink-3)' }}>
          {Ico.chevDown(11)}
        </span>
      </button>
      {open && (
        <div style={{
          position: 'absolute', top: 'calc(100% + 4px)', left: 0,
          minWidth: 160, zIndex: 20,
          background: 'var(--surface)',
          // No border — floats on --sh-popup alone (ENG-790).
          borderRadius: 8,
          boxShadow: 'var(--sh-popup)',
          padding: '4px 0',
        }}>
          {options.map((opt) => (
            <button
              key={opt.id}
              type="button"
              onClick={() => { onChange?.(opt.id); setOpen(false); }}
              style={{
                display: 'flex', alignItems: 'center',
                width: 'calc(100% - 8px)', margin: '0 4px',
                padding: '7px 10px', borderRadius: 5,
                background: opt.id === value ? 'var(--surface-2)' : 'transparent',
                border: 0,
                fontFamily: FONT_BODY, fontSize: 12.5,
                color: 'var(--ink-2)', textAlign: 'left',
                cursor: 'pointer',
              }}
              onMouseOver={(e) => { e.currentTarget.style.background = 'var(--surface-2)'; }}
              onMouseOut={(e) => { e.currentTarget.style.background = opt.id === value ? 'var(--surface-2)' : 'transparent'; }}
            >
              {opt.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
