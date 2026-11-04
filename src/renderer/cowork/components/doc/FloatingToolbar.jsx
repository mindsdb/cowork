// The bar over selected words: inline formatting, a link, and "Edit with agent".
// It formats the selection it was raised for (`toolbar.editable`, `toolbar.range`).
import { useState } from 'react';
import { Bold, Code, Italic, Link, Sparkles, Strikethrough } from 'lucide-react';
import { Icon } from '../ui/Icon';
import FloatPanel from './FloatPanel';
import { applyInlineFormat, wrapSelection } from './caret';

const FORMATS = [
  { kind: 'bold', label: 'Bold', title: 'Bold ⌘B', icon: Bold },
  { kind: 'italic', label: 'Italic', title: 'Italic ⌘I', icon: Italic },
  { kind: 'strike', label: 'Strikethrough', title: 'Strikethrough ⌘⇧X', icon: Strikethrough },
  { kind: 'code', label: 'Code', title: 'Code ⌘E', icon: Code },
];

export default function FloatingToolbar({ toolbar, canFormat, canAsk, onLinkMode, onClose, onAsk }) {
  const [href, setHref] = useState('');
  if (!canFormat && !canAsk) return null;
  const { editable: el, range } = toolbar;
  const link = (value) => {
    if (el && range) {
      // The link box has the focus now: give the words their selection back first.
      const url = /^(https?:|mailto:)/i.test(value) ? value : `https://${value}`;
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
      if (wrapSelection(el, 'a', { href: url })) el.dispatchEvent(new Event('input', { bubbles: true }));
      el.focus();
    }
    onClose();
  };
  const place = { rect: toolbar.rect, side: 'above', align: 'center', gap: 8, className: 'doc-float' };
  if (toolbar.mode === 'link') {
    return (
      <FloatPanel {...place} role="dialog" aria-label="Add link">
        <input className="doc-float__input" autoFocus aria-label="Link address" placeholder="Paste a link and press Enter" value={href}
          onChange={(e) => setHref(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); if (href.trim()) link(href.trim()); } if (e.key === 'Escape') onClose(); }} />
      </FloatPanel>
    );
  }
  return (
    <FloatPanel {...place} role="toolbar" aria-label="Format" onMouseDown={(e) => e.preventDefault()}>
      {canFormat && (
        <>
          {FORMATS.map((f) => (
            <button key={f.kind} type="button" className="doc-float__btn" aria-label={f.label} title={f.title} onClick={() => applyInlineFormat(f.kind, el)}>
              <Icon of={f.icon} size={14} />
            </button>
          ))}
          <button type="button" className="doc-float__btn" aria-label="Link" title="Link ⌘K" onClick={onLinkMode}><Icon of={Link} size={14} /></button>
        </>
      )}
      {canFormat && canAsk && <span className="doc-float__sep" />}
      {canAsk && (
        <button type="button" className="doc-float__btn doc-float__btn--agent" onClick={onAsk}>
          <Icon of={Sparkles} size={14} /> Edit with agent
        </button>
      )}
    </FloatPanel>
  );
}
