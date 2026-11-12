// The viewer's chat bar (ENG-4227): a thin composer at the bottom of Preview,
// styled like the review composer, with the thread of quick edits above it.
// State and the stream live in useQuickEdit; this file only draws them.

import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowUpIcon } from '../comments/icons';
import { Spinner, Tooltip } from '../../ui';
import { useTranslation } from '../../../../lib/i18n';

const MAX_HEIGHT = 120; // px — ~5 lines before the textarea scrolls
const KNOWN_STAGES = new Set(['reading', 'writing', 'checking', 'fixing']);

function ReplyStatus({ reply, canUndo, busy, onUndo, onAskAgent, onOpenChat }) {
  const { t } = useTranslation('artifacts');
  const link = 'artifact-quick-edit-link';
  if (reply.state === 'running' || reply.state === 'handing-off') {
    const stage = reply.state === 'handing-off'
      ? t('quickEdit.handingOff')
      : KNOWN_STAGES.has(reply.stage)
        ? t(`quickEdit.stage.${reply.stage}`)
        : reply.route === 'agent'
          ? t('quickEdit.route.agent')
          : reply.route === 'edit'
            ? t('quickEdit.route.edit')
            : t('quickEdit.stage.routing');
    return (
      <span className="artifact-quick-edit-status" role="status">
        <Spinner /> {stage}
      </span>
    );
  }
  if (reply.state === 'applied') {
    return (
      <span>
        {reply.summary || t('quickEdit.applied')}
        {reply.undone ? (
          <span className="artifact-quick-edit-muted"> {t('quickEdit.undone')}</span>
        ) : canUndo ? (
          <>
            {' '}
            <button type="button" className={link} disabled={busy || reply.undoing} onClick={onUndo}>
              {reply.undoing ? t('quickEdit.undoing') : t('quickEdit.undo')}
            </button>
          </>
        ) : null}
        {reply.undoError && <span className="artifact-quick-edit-error" role="alert"> {reply.undoError}</span>}
      </span>
    );
  }
  if (reply.state === 'noop') {
    return <span>{t('quickEdit.noop')}{reply.summary ? ` ${reply.summary}` : ''}</span>;
  }
  if (reply.state === 'failed') {
    return (
      <span>
        {reply.summary || t('quickEdit.failed')}
        {' '}
        <button type="button" className={link} disabled={busy} onClick={onAskAgent}>
          {t('quickEdit.askAgent')}
        </button>
      </span>
    );
  }
  if (reply.state === 'chat') {
    return (
      <span>
        {t('quickEdit.continuedInChat')}
        {onOpenChat && (
          <>
            {' '}
            <button type="button" className={link} onClick={onOpenChat}>
              {t('quickEdit.openChat')}
            </button>
          </>
        )}
      </span>
    );
  }
  return <span className="artifact-quick-edit-error" role="alert">{reply.error || t('quickEdit.errors.failed')}</span>;
}

export function QuickEditBar({ controller, disabledReason = '', onOpenChat }) {
  const { t } = useTranslation('artifacts');
  const { messages, running, direct = true, send, askAgent, undo, undoableId } = controller;
  const [text, setText] = useState('');
  const taRef = useRef(null);
  const threadRef = useRef(null);

  const grow = useCallback(() => {
    const ta = taRef.current;
    if (!ta) return;
    ta.style.height = 'auto';
    const h = Math.min(MAX_HEIGHT, ta.scrollHeight);
    ta.style.height = `${h}px`;
    ta.style.overflowY = ta.scrollHeight > MAX_HEIGHT ? 'auto' : 'hidden';
  }, []);

  // Keep the newest reply in view as it moves through its stages.
  useEffect(() => {
    const el = threadRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages]);

  const blocked = running || !!disabledReason;
  const canSend = !blocked && !!text.trim();

  const submit = useCallback(() => {
    if (!canSend) return;
    const message = text;
    setText('');
    requestAnimationFrame(grow);
    void send(message);
  }, [canSend, grow, send, text]);

  return (
    <div className="artifact-quick-edit" aria-label={t('quickEdit.ariaLabel')} role="region">
      {messages.length > 0 && (
        <div className="artifact-quick-edit-thread" ref={threadRef} aria-live="polite">
          {messages.map((m) => (m.role === 'user' ? (
            <div key={m.id} className="artifact-quick-edit-msg is-user">{m.text}</div>
          ) : (
            <div key={m.id} className="artifact-quick-edit-msg is-reply">
              <ReplyStatus
                reply={m}
                canUndo={m.id === undoableId}
                busy={running}
                onUndo={() => undo(m.id)}
                onAskAgent={() => askAgent(m.id)}
                onOpenChat={onOpenChat}
              />
            </div>
          )))}
        </div>
      )}
      {disabledReason && (
        <div className="artifact-quick-edit-muted artifact-quick-edit-hint">{disabledReason}</div>
      )}
      <div className="shrink-0 flex items-end gap-[2px] bg-surface rounded-[16px]
        border-[0.5px] border-[rgba(39,39,42,0.15)] py-[8px] pl-[8px] pr-[4px]
        focus-within:border-[rgba(39,39,42,0.3)] transition-colors">
        <textarea
          ref={taRef}
          rows={1}
          value={text}
          // Chat only: the bar is a way into the chat, for questions too.
          placeholder={direct ? t('quickEdit.placeholder') : t('quickEdit.placeholderChat')}
          aria-label={t('quickEdit.inputLabel')}
          disabled={!!disabledReason}
          className="flex-1 min-w-0 resize-none outline-none border-0 bg-transparent
            text-[14px] leading-[24px] text-ink placeholder:text-ink-4 px-[4px]"
          style={{ fontFamily: 'inherit', height: 24, overflowY: 'hidden' }}
          onChange={(e) => { setText(e.target.value); requestAnimationFrame(grow); }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent?.isComposing) {
              e.preventDefault();
              submit();
            }
          }}
        />
        <Tooltip content={t('quickEdit.send')}>
          <button
            type="button"
            aria-label={t('quickEdit.send')}
            disabled={!canSend}
            onClick={submit}
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
    </div>
  );
}

export default QuickEditBar;
