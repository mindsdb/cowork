// The smaller blocks: metrics, code, image, pending, divider.
import { useEffect, useRef, useState } from 'react';
import { Copy, Sparkles, TrendingDown, TrendingUp } from 'lucide-react';
import { Icon } from '../ui/Icon';
import EditableText from './EditableText';
import { useFlushOnUnmount, usePendingEdit } from './useSaveIndicator';

export function MetricsBlock({ block, editable, onOps }) {
  const setItem = (i, patch) => {
    const items = block.items.map((it, j) => (j === i ? { ...it, ...patch } : it));
    onOps([{ op: 'update', id: block.id, set: { items } }]);
  };
  return (
    <div className="doc-metrics" role="list">
      {block.items.map((m, i) => {
        const dir = /^\s*[-−]/.test(m.delta || '') ? 'down' : /^\s*\+/.test(m.delta || '') ? 'up' : null;
        const tone = m.tone || null;
        return (
          <div className="doc-metric" role="listitem" key={i}>
            <EditableText className="doc-metric__label" value={m.label} plain singleLine editable={editable}
              onCommit={(label) => setItem(i, { label })} placeholder="Label" />
            <EditableText className="doc-metric__value" value={m.value} plain singleLine editable={editable}
              onCommit={(value) => setItem(i, { value })} placeholder="0" />
            {(m.delta || editable) && (
              <div className={`doc-metric__delta ${tone === 'good' ? 'doc-metric__delta--good' : tone === 'bad' ? 'doc-metric__delta--bad' : ''}`}>
                {dir && <Icon of={dir === 'up' ? TrendingUp : TrendingDown} size={12} />}
                <EditableText value={m.delta || ''} plain singleLine editable={editable}
                  onCommit={(delta) => setItem(i, { delta })} placeholder={editable ? 'Change' : ''} />
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

export function CodeBlock({ block, editable, onOps }) {
  const ref = useRef(null);
  const [draft, setDraft] = useState(block.code || '');
  // Typed code is committed on leaving the box, so until then it is an edit
  // waiting, as the save indicator says; and committed if the block goes
  // first, as EditableText's text is.
  const { setDirty } = usePendingEdit();
  // The language as typed while its box has the focus; otherwise the block's
  // own, so a change from the agent or another window shows.
  const [lang, setLang] = useState(null);
  const [copied, setCopied] = useState(false);
  const copiedTimer = useRef(null);
  useEffect(() => () => clearTimeout(copiedTimer.current), []);
  useEffect(() => {
    if (document.activeElement !== ref.current) setDraft(block.code || '');
  }, [block.code]);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }, [draft]);
  const edit = (next) => { setDraft(next); setDirty(true); };
  const commit = () => {
    setDirty(false);
    if (draft !== (block.code || '')) onOps([{ op: 'update', id: block.id, set: { code: draft } }]);
  };
  useFlushOnUnmount(commit);
  return (
    <div className="doc-code">
      <div className="doc-code__bar">
        <input
          className="doc-code__lang"
          value={lang ?? block.language ?? ''}
          placeholder="plain text"
          readOnly={!editable}
          aria-label="Code language"
          onFocus={() => setLang(block.language || '')}
          onChange={(e) => setLang(e.target.value)}
          onBlur={() => {
            if (lang != null && lang !== (block.language || '')) onOps([{ op: 'update', id: block.id, set: { language: lang } }]);
            setLang(null);
          }}
        />
        <button type="button" className="doc-iconbtn" aria-label="Copy code"
          onClick={() => {
            navigator.clipboard?.writeText(draft);
            setCopied(true);
            clearTimeout(copiedTimer.current);
            copiedTimer.current = setTimeout(() => setCopied(false), 1200);
          }}>
          {copied ? <span style={{ fontSize: 11 }}>Copied</span> : <Icon of={Copy} size={14} />}
        </button>
      </div>
      <textarea
        ref={ref}
        className="doc-code__text"
        value={draft}
        readOnly={!editable}
        spellCheck={false}
        aria-label="Code"
        rows={1}
        onChange={(e) => edit(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Tab') {
            e.preventDefault();
            const el = e.currentTarget;
            const s = el.selectionStart;
            edit(draft.slice(0, s) + '  ' + draft.slice(el.selectionEnd));
            requestAnimationFrame(() => { el.selectionStart = el.selectionEnd = s + 2; });
          }
        }}
      />
    </div>
  );
}

export function ImageBlock({ block, editable, onOps }) {
  return (
    <figure className="doc-figure">
      <img src={block.src} alt={block.alt || ''} loading="lazy" />
      {(block.caption || editable) && (
        <EditableText as="figcaption" value={block.caption || ''} plain singleLine editable={editable}
          placeholder="Add a caption" onCommit={(caption) => onOps([{ op: 'update', id: block.id, set: { caption } }])} />
      )}
    </figure>
  );
}

export function PendingBlock({ block, live }) {
  return (
    <div className={`doc-pending ${live ? 'doc-pending--live' : ''}`} aria-live="polite">
      <div className="doc-pending__head">
        <Icon of={Sparkles} size={14} />
        <span>{live ? 'Writing' : 'To be written'}:</span>
        <span className="doc-pending__intent">{block.intent}</span>
      </div>
      {live && (
        <div className="doc-pending__lines" aria-hidden="true">
          <div className="doc-pending__line" style={{ width: '92%' }} />
          <div className="doc-pending__line" style={{ width: '78%' }} />
          <div className="doc-pending__line" style={{ width: '60%' }} />
        </div>
      )}
    </div>
  );
}

export function DividerBlock() {
  return <hr className="doc-divider" />;
}
