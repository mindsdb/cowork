// "Edit with agent": what the person wants changed (or written) at the blocks
// they picked, sent to the chat with the quote. A comment on those blocks
// (`target.mode` 'comment') is written in the same box, in the inbox's words.
import { useState } from 'react';
import FloatPanel from './FloatPanel';
import { useTranslation } from '../../../lib/i18n';

// Where the box goes when its block could not be measured.
const FALLBACK_RECT = { top: 120, left: 120, bottom: 140, width: 0 };

export default function AskAgent({ target, onSubmit, onCancel }) {
  const { t } = useTranslation('docs');
  const { t: tArtifacts } = useTranslation('artifacts');
  const [text, setText] = useState('');
  const comment = target.mode === 'comment';
  const label = comment ? tArtifacts('comments.composer.ariaLabel') : t('ask.label');
  const placeholder = comment
    ? tArtifacts('comments.composer.placeholder')
    : t(target.mode === 'write' ? 'ask.placeholderWrite' : 'ask.placeholderChange');
  return (
    <FloatPanel rect={target.rect || FALLBACK_RECT} gap={8} className="doc-float doc-ask" role="dialog" aria-label={label}>
      {target.quote && <div className="doc-ask__quote">{target.quote}</div>}
      <div className="doc-ask__row">
        <input
          className="doc-ask__input"
          autoFocus
          aria-label={comment ? label : t('ask.request')}
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
          {comment ? tArtifacts('comments.composer.send') : t('ask.send')}
        </button>
      </div>
    </FloatPanel>
  );
}
