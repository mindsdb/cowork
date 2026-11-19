// Pinned composer at the bottom of the comments inbox — creates UNANCHORED
// (general) threads: comments not attached to any element on the page
// (selector: null). Anchored comments are still created on the artifact via
// comment mode; this is the only UI path that posts without a selector.
//
// Enter posts, Shift+Enter inserts a newline. On failure the draft stays in
// the field (the hook surfaces the error banner) so the user can retry.

import { useCallback, useRef, useState } from 'react';
import { ArrowUpIcon } from './icons';
import { Tooltip } from '../../ui';
import { AttachmentStrip } from '../../AttachmentChip';
import { useImageAttachments } from '../../../lib/imageAttachments';
import { FileDropOverlay } from '../../../lib/useFileDrop';
import { useTranslation } from '../../../../lib/i18n';

const MAX_HEIGHT = 120; // px — ~5 lines before the textarea scrolls

export function UnanchoredComposer({
  onCreate,
  onPosted,
  kind = 'review',
  placeholder: placeholderProp,
}) {
  const { t } = useTranslation('artifacts');
  const placeholder = placeholderProp ?? t('comments.composer.placeholder');
  const [text, setText] = useState('');
  const [pending, setPending] = useState(false);
  const taRef = useRef(null);
  // Pasted or dropped images, stored with the comment (ENG-4410).
  const attachments = useImageAttachments({ disabled: pending });

  const grow = useCallback(() => {
    const ta = taRef.current;
    if (!ta) return;
    ta.style.height = 'auto';
    const h = Math.min(MAX_HEIGHT, ta.scrollHeight);
    ta.style.height = `${h}px`;
    ta.style.overflowY = ta.scrollHeight > MAX_HEIGHT ? 'auto' : 'hidden';
  }, []);

  const hasContent = !!text.trim() || attachments.images.length > 0;
  const canSend = !pending && hasContent;

  const send = useCallback(async () => {
    if (pending || !hasContent) return;
    setPending(true);
    const images = attachments.images.map((image) => image.pendingFile);
    const ok = await onCreate?.({ selector: null, text, kind, images });
    setPending(false);
    if (ok) {
      setText('');
      attachments.clear();
      requestAnimationFrame(grow);
      onPosted?.();
      taRef.current?.focus();
    }
  }, [pending, hasContent, attachments, text, kind, onCreate, onPosted, grow]);

  return (
    <div
      className="relative shrink-0 flex flex-col bg-surface rounded-[16px]
        border-[0.5px] border-[rgba(39,39,42,0.15)]
        focus-within:border-[rgba(39,39,42,0.3)] transition-colors"
      {...attachments.dropHandlers}
    >
      <AttachmentStrip attachments={attachments.images} onRemove={attachments.remove} className="artifact-image-strip" />
      {attachments.error && <div className="artifact-image-error" role="alert">{attachments.error}</div>}
      <div className="flex items-end gap-[2px] py-[8px] pl-[8px] pr-[4px]">
      <textarea
        ref={taRef}
        rows={1}
        value={text}
        placeholder={placeholder}
        aria-label={t('comments.composer.ariaLabel')}
        disabled={pending}
        className="flex-1 min-w-0 resize-none outline-none border-0 bg-transparent
          text-[14px] leading-[24px] text-ink placeholder:text-ink-4 px-[4px]"
        style={{ fontFamily: 'inherit', height: 24, overflowY: 'hidden' }}
        onChange={(e) => { setText(e.target.value); requestAnimationFrame(grow); }}
        onPaste={attachments.onPaste}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
        }}
      />
      <Tooltip content={t('comments.composer.send')}>
        <button
          type="button"
          aria-label={t('comments.composer.send')}
          disabled={!canSend}
          onClick={send}
          className={[
            'w-[24px] h-[24px] rounded-full flex items-center justify-center shrink-0',
            'border-0 p-0 transition-[background,opacity,transform] active:scale-[.92]',
            canSend
              ? 'bg-[#146573] text-white opacity-100 cursor-pointer'
              : 'bg-transparent text-ink opacity-45 cursor-default',
          ].join(' ')}
        >
          <ArrowUpIcon />
        </button>
      </Tooltip>
      </div>
      <FileDropOverlay active={attachments.isDragging} label={t('imageAttachments.drop')} />
    </div>
  );
}

export default UnanchoredComposer;
