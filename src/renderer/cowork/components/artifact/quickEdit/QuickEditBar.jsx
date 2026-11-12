// The viewer's chat bar (ENG-4227): a thin composer at the bottom of Preview,
// styled like the review composer, with the thread of quick edits above it
// and, when the server can edit directly, the composer's model picker beside
// send. State and the stream live in useQuickEdit; this file only draws them.
//
// A message handed to the chat shows the agent's reply here as it streams,
// read from the chat's own task state (lib/quickEditPrompt chatReplyFor).
// Closing the viewer shows that chat, so the bar offers "Open in chat" only
// while the turn waits for an answer there.

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import Ico from '../../Icons';
import { ArrowUpIcon } from '../comments/icons';
import { Spinner, Tooltip } from '../../ui';
import { MarkdownContent } from '../../markdown/MarkdownContent';
import { chatReplyFor } from '../../../lib/quickEditPrompt';
import { useTranslation } from '../../../../lib/i18n';

const MAX_HEIGHT = 120; // px — ~5 lines before the textarea scrolls
// The thread grows to this, then scrolls (same as .artifact-quick-edit-thread).
const MAX_THREAD_HEIGHT = 168;

/*
 * Motion (ENG-4227): the thread's height follows its content through a
 * measured height transition (--dur-layout, --ease-out), so it grows instead
 * of snapping, and each message enters once with a short fade and rise
 * (.is-entering, removed on animationend so a streaming update never starts
 * it again). Both run on --dur-layout, which prefers-reduced-motion sets to
 * 0ms, and the reduced-motion rule drops the rise.
 */
function useThreadHeight(innerRef, active) {
  const [height, setHeight] = useState(0);
  useLayoutEffect(() => {
    const el = innerRef.current;
    if (!active || !el) { setHeight(0); return undefined; }
    const measure = () => setHeight(Math.min(el.scrollHeight, MAX_THREAD_HEIGHT));
    // A frame later, so a thread that just appeared grows from nothing.
    const frame = requestAnimationFrame(measure);
    if (typeof ResizeObserver === 'undefined') return () => cancelAnimationFrame(frame);
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => { cancelAnimationFrame(frame); observer.disconnect(); };
  }, [innerRef, active]);
  return height;
}
const KNOWN_STAGES = new Set(['reading', 'writing', 'checking', 'fixing']);

// A quiet action under a reply: icon and label in ink-3, filled on hover, the
// composer's ghost-button treatment at reply size.
function ReplyAction({ icon, label, onClick, disabled = false, busy = false }) {
  return (
    <button
      type="button"
      className="artifact-quick-edit-action"
      disabled={disabled || busy}
      aria-busy={busy || undefined}
      onClick={onClick}
    >
      {busy ? <Spinner /> : icon}
      <span>{label}</span>
    </button>
  );
}

function OpenInChat({ onOpenChat }) {
  const { t } = useTranslation('artifacts');
  if (!onOpenChat) return null;
  return <ReplyAction icon={Ico.arrowUpRight(14)} label={t('quickEdit.openInChat')} onClick={onOpenChat} />;
}

// The reply of a message that went to the chat, mirrored from it.
function ChatMirror({ reply, chatMessages, onOpenChat }) {
  const { t } = useTranslation('artifacts');
  const mirror = chatMessages ? chatReplyFor(chatMessages, reply.chatPrompt, reply.chatBefore || 0) : null;
  if (mirror?.needsAnswer) {
    return (
      <>
        <span className="artifact-quick-edit-muted">{t('quickEdit.needsAnswer')}</span>
        <div className="artifact-quick-edit-actions"><OpenInChat onOpenChat={onOpenChat} /></div>
      </>
    );
  }
  if (mirror?.text) {
    return (
      <>
        <div className="artifact-quick-edit-mirror" data-live={mirror.live || undefined}>
          <MarkdownContent text={mirror.text} id={`quick-edit-${reply.id}`} complete={!mirror.live} size="dense" isAssistant animateStreamingWords={false} />
        </div>
        {mirror.live && (
          <div className="artifact-quick-edit-actions"><span className="artifact-quick-edit-status"><Spinner /></span></div>
        )}
      </>
    );
  }
  const label = mirror?.failed
    ? t('quickEdit.chatStopped')
    : mirror
      ? t('quickEdit.workingInChat')
      : t('quickEdit.sentToChat');
  return (
    <>
      <span className="artifact-quick-edit-status" role="status">
        {mirror && !mirror.failed ? <Spinner /> : null}{label}
      </span>
    </>
  );
}

function ReplyStatus({ reply, canUndo, busy, onUndo, onAskAgent, onOpenChat, chatMessages }) {
  const { t } = useTranslation('artifacts');
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
      <>
        <span>{reply.summary || t('quickEdit.applied')}</span>
        {(reply.undone || canUndo) && (
          <div className="artifact-quick-edit-actions">
            {reply.undone ? (
              <span className="artifact-quick-edit-action is-done" role="status">
                {Ico.check(14)}<span>{t('quickEdit.undone')}</span>
              </span>
            ) : (
              <ReplyAction
                icon={Ico.undo(14)}
                label={reply.undoing ? t('quickEdit.undoing') : t('quickEdit.undo')}
                busy={!!reply.undoing}
                disabled={busy}
                onClick={onUndo}
              />
            )}
          </div>
        )}
        {reply.undoError && <div className="artifact-quick-edit-error" role="alert">{reply.undoError}</div>}
      </>
    );
  }
  if (reply.state === 'noop') {
    return <span>{t('quickEdit.noop')}{reply.summary ? ` ${reply.summary}` : ''}</span>;
  }
  if (reply.state === 'failed') {
    return (
      <>
        <span>{reply.summary || t('quickEdit.failed')}</span>
        <div className="artifact-quick-edit-actions">
          <ReplyAction icon={Ico.sparkle(14)} label={t('quickEdit.askAgent')} disabled={busy} onClick={onAskAgent} />
        </div>
      </>
    );
  }
  if (reply.state === 'chat') {
    return <ChatMirror reply={reply} chatMessages={chatMessages} onOpenChat={onOpenChat} />;
  }
  return <span className="artifact-quick-edit-error" role="alert">{reply.error || t('quickEdit.errors.failed')}</span>;
}

export function QuickEditBar({ controller, disabledReason = '', onOpenChat, chatMessages = null, picker = null }) {
  const { t } = useTranslation('artifacts');
  const { messages, running, direct = true, send, askAgent, undo, undoableId } = controller;
  const [text, setText] = useState('');
  const taRef = useRef(null);
  const threadRef = useRef(null);
  const threadInnerRef = useRef(null);
  const threadHeight = useThreadHeight(threadInnerRef, messages.length > 0);
  // Messages whose entrance has played: they never get .is-entering again.
  const enteredRef = useRef(new Set());
  const [, setEnteredCount] = useState(0);
  const entered = useCallback((id) => {
    if (enteredRef.current.has(id)) return;
    enteredRef.current.add(id);
    setEnteredCount(enteredRef.current.size);
  }, []);
  const entryClass = (id) => (enteredRef.current.has(id) ? '' : ' is-entering');

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
  }, [messages, threadHeight]);

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
        <div className="artifact-quick-edit-thread" ref={threadRef} aria-live="polite" style={{ height: threadHeight }}>
          <div className="artifact-quick-edit-thread-inner" ref={threadInnerRef}>
          {messages.map((m) => (m.role === 'user' ? (
            <div
              key={m.id}
              className={`artifact-quick-edit-msg is-user${entryClass(m.id)}`}
              onAnimationEnd={() => entered(m.id)}
            >{m.text}</div>
          ) : (
            <div
              key={m.id}
              className={`artifact-quick-edit-msg is-reply${entryClass(m.id)}`}
              onAnimationEnd={(e) => { if (e.target === e.currentTarget) entered(m.id); }}
            >
              <ReplyStatus
                reply={m}
                canUndo={m.id === undoableId}
                busy={running}
                onUndo={() => undo(m.id)}
                onAskAgent={() => askAgent(m.id)}
                onOpenChat={onOpenChat}
                chatMessages={chatMessages}
              />
            </div>
          )))}
          </div>
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
        {picker && <div className="artifact-quick-edit-picker">{picker}</div>}
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
