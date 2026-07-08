import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import Ico from '../Icons';

const THEMES = {
  error:   { bg: 'color-mix(in srgb, var(--danger) 12%, var(--surface))',  border: 'color-mix(in srgb, var(--danger) 40%, transparent)',  color: 'var(--danger)',  accent: 'var(--danger)' },
  success: { bg: 'color-mix(in srgb, var(--success) 12%, var(--surface))', border: 'color-mix(in srgb, var(--success) 40%, transparent)', color: 'var(--ink-2)', accent: 'var(--success)' },
};

// align: 'center' (default) or 'right'
// duration: ms before auto-dismiss (default 4000, 0 = no auto-dismiss)
export function Toast({ message, type = 'error', onClose, duration = 4000, align = 'center' }) {
  useEffect(() => {
    if (!message || !duration) return;
    const t = setTimeout(onClose, duration);
    return () => clearTimeout(t);
  }, [message, duration, onClose]);

  if (!message) return null;
  const theme = THEMES[type] || THEMES.error;
  const pos = align === 'right'
    ? { top: 24, right: 32 }
    : { top: 24, left: '50%', transform: 'translateX(-50%)' };

  return createPortal(
    <div style={{
      position: 'fixed', zIndex: 2000,
      ...pos,
      display: 'inline-flex', alignItems: 'center', gap: 10,
      padding: '10px 16px',
      borderRadius: 10,
      background: theme.bg,
      border: `1px solid ${theme.border}`,
      color: theme.color,
      fontSize: 13,
      fontFamily: 'var(--font-body)',
      boxShadow: '0 8px 24px rgba(0,0,0,0.18)',
      maxWidth: 480,
      pointerEvents: 'auto',
    }}>
      <span style={{ flexShrink: 0, color: theme.accent }}>
        {type === 'success' ? '✓' : (Ico.warning ? Ico.warning(14) : '⚠')}
      </span>
      <span style={{ flex: 1 }}>{message}</span>
      <button
        type="button"
        onClick={onClose}
        style={{ background: 'none', border: 0, color: theme.color, cursor: 'pointer', flexShrink: 0, padding: 0, opacity: 0.7 }}
      >
        {Ico.close ? Ico.close(12) : '×'}
      </button>
    </div>,
    document.body,
  );
}
