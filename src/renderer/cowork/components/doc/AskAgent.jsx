// "Edit with agent": what the person wants changed (or written) at the blocks
// they picked, sent to the chat with the quote. A comment on those blocks is
// written in the same box, with its own words (`labels`).
import { useState } from 'react';
import FloatPanel from './FloatPanel';
import { useTranslation } from '../../../lib/i18n';

// Where the box goes when its block could not be measured.
const FALLBACK_RECT = { top: 120, left: 120, bottom: 140, width: 0 };

export default function AskAgent({ target, onSubmit, onCancel, labels = null }) {
  const { t } = useTranslation('docs');
  const [text, setText] = useState('');
  const placeholder = labels?.placeholder ?? t(target.mode === 'write' ? 'ask.placeholderWrite' : 'ask.placeholderChange');
  return (
    <FloatPanel rect={target.rect || FALLBACK_RECT} gap={8} className="doc-float doc-ask" role="dialog" aria-label={labels?.label ?? t('ask.label')}>
      {target.quote && <div className="doc-ask__quote">{target.quote}</div>}
      <div className="doc-ask__row">
        <input
          className="doc-ask__input"
          autoFocus
          aria-label={labels?.input ?? t('ask.request')}
          placeholder={placeholder}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); onSubmit(text); }
            if (e.key === 'Escape') { e.preventDefault(); onCancel(); }
          }}
          onBlur={() => setTimeout(() => !text && onCancel(), 150)}
        />
        <button type="button" className="doc-float__btn doc-float__btn--agent" onMouseDown={(e) => e.preventDefault()} onClick={() => onSubmit(text)} disabled={!text.trim()}>
          {labels?.send ?? t('ask.send')}
        </button>
      </div>
    </FloatPanel>
  );
}
