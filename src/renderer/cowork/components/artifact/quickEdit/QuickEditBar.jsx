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
// After the viewer's open animation (--dur-modal, 150ms) has settled.
export const AUTOFOCUS_DELAY_MS = 220;
const PHONE_MAX_WIDTH = 768;

/** Touch or phone width, where focusing an input pops the keyboard. */
export function isTouchViewport() {
  try {
    if (window.matchMedia?.('(pointer: coarse)')?.matches) return true;
  } catch { /* no media queries: judge by width */ }
  return (window.innerWidth || 0) > 0 && window.innerWidth < PHONE_MAX_WIDTH;
}

const isTypingTarget = (el) => !!el && (el.isContentEditable
  || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName));

/*
 * Puts the caret in the bar when the viewer opens, and when Live edit is
 * turned on, so it reads as the place to type (ENG-4227). Once per
 * `focusRequest` (the viewer bumps it for those two moments, and remembers
 * the one it already used in `focusUsed`), after the open animation, and only
 * when nobody has started elsewhere: no click or key since the request, no
 * other field focused, and never on a touch or phone-width screen.
 */
function useAutoFocus(inputRef, { focusRequest, focusUsed, blocked }) {
  useEffect(() => {
    if (!focusRequest || !focusUsed || focusUsed.current === focusRequest) return undefined;
    if (blocked || isTouchViewport()) {
      focusUsed.current = focusRequest;
      return undefined;
    }
    let interacted = false;
    const onInteract = () => { interacted = true; };
    document.addEventListener('pointerdown', onInteract, true);
    document.addEventListener('keydown', onInteract, true);
    // Used up when the timer fires, not when it is set: StrictMode runs this
    // effect twice, and the first run's timer is cleared before it fires.
    const timer = setTimeout(() => {
      focusUsed.current = focusRequest;
      const input = inputRef.current;
      const active = document.activeElement;
      if (interacted || !input || input.disabled) return;
      if (active && active !== input && isTypingTarget(active)) return;
      input.focus({ preventScroll: true });
    }, AUTOFOCUS_DELAY_MS);
    return () => {
      clearTimeout(timer);
      document.removeEventListener('pointerdown', onInteract, true);
      document.removeEventListener('keydown', onInteract, true);
    };
  }, [focusRequest, focusUsed, blocked, inputRef]);
}

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

// What a finished reply offers beside its bubble, on the same row: Undo (and
// its Undoing… / Undone states) after an applied edit, "Ask the agent
// instead" after a failed one. Null for any other reply.
const hasReplySide = (reply, canUndo) => (reply.state === 'applied' && (reply.undone || canUndo))
  || reply.state === 'failed';

function ReplySide({ reply, canUndo, busy, onUndo, onAskAgent }) {
  const { t } = useTranslation('artifacts');
  if (reply.state === 'applied') {
    if (reply.undone) {
      return (
        <span className="artifact-quick-edit-action is-done" role="status">
          {Ico.check(14)}<span>{t('quickEdit.undone')}</span>
        </span>
      );
    }
    if (!canUndo) return null;
    return (
      <ReplyAction
        icon={Ico.undo(14)}
        label={reply.undoing ? t('quickEdit.undoing') : t('quickEdit.undo')}
        busy={!!reply.undoing}
        disabled={busy}
        onClick={onUndo}
      />
    );
  }
  if (reply.state === 'failed') {
    return <ReplyAction icon={Ico.sparkle(14)} label={t('quickEdit.askAgent')} disabled={busy} onClick={onAskAgent} />;
  }
  return null;
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
      </>
    );
  }
  if (reply.state === 'chat') {
    return <ChatMirror reply={reply} chatMessages={chatMessages} onOpenChat={onOpenChat} />;
  }
  return <span className="artifact-quick-edit-error" role="alert">{reply.error || t('quickEdit.errors.failed')}</span>;
}

/**
 * `unsaved`: the code editor holds text never saved. Sending then asks first,
 * in a small confirm anchored to the bar: save and send (through
 * `onSaveUnsaved`, which resolves to the new revision's id, or null when the
 * save failed), discard and send (`onDiscardUnsaved`), or cancel.
 */
export function QuickEditBar({
  controller, onOpenChat, chatMessages = null, picker = null,
  focusRequest = 0, focusUsed = null,
  unsaved = false, onSaveUnsaved, onDiscardUnsaved,
}) {
  const { t } = useTranslation('artifacts');
  const { messages, running, direct = true, send, askAgent, undo, undoableId } = controller;
  const [text, setText] = useState('');
  const taRef = useRef(null);
  const threadRef = useRef(null);
  const threadInnerRef = useRef(null);
  useAutoFocus(taRef, { focusRequest, focusUsed, blocked: unsaved });
  // The unsaved-changes confirm: null, 'open', or 'saving' while a save runs.
  const [confirm, setConfirm] = useState(null);
  const [sendError, setSendError] = useState('');
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

  const canSend = !running && !confirm && !!text.trim();

  const dispatch = useCallback((options) => {
    const message = text;
    setText('');
    setConfirm(null);
    requestAnimationFrame(grow);
    void send(message, options);
  }, [grow, send, text]);

  const submit = useCallback(() => {
    if (!canSend) return;
    setSendError('');
    // Unsaved editor text: ask before the edit lands on top of it.
    if (unsaved) {
      setConfirm('open');
      return;
    }
    dispatch();
  }, [canSend, dispatch, unsaved]);

  const saveAndSend = useCallback(async () => {
    setConfirm('saving');
    let revisionId = null;
    try {
      revisionId = await onSaveUnsaved?.();
    } catch {
      revisionId = null;
    }
    if (!revisionId) {
      // Nothing is sent and the message stays in the input.
      setConfirm(null);
      setSendError(t('quickEdit.unsavedConfirm.saveFailed'));
      return;
    }
    dispatch({ expectedRevisionId: revisionId });
  }, [dispatch, onSaveUnsaved, t]);

  const discardAndSend = useCallback(() => {
    onDiscardUnsaved?.();
    dispatch();
  }, [dispatch, onDiscardUnsaved]);

  const cancelConfirm = useCallback(() => {
    setConfirm(null);
    taRef.current?.focus();
  }, []);

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
            // The bubble takes the row's width; Undo or "Ask the agent instead"
            // sits beside it, centred on it, never shrinking or wrapping.
            <div
              key={m.id}
              className={`artifact-quick-edit-row${entryClass(m.id)}`}
              onAnimationEnd={(e) => { if (e.target === e.currentTarget) entered(m.id); }}
            >
              <div className="artifact-quick-edit-msg is-reply">
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
              {hasReplySide(m, m.id === undoableId) && (
                <div className="artifact-quick-edit-side">
                  <ReplySide
                    reply={m}
                    canUndo={m.id === undoableId}
                    busy={running}
                    onUndo={() => undo(m.id)}
                    onAskAgent={() => askAgent(m.id)}
                  />
                </div>
              )}
            </div>
          )))}
          </div>
        </div>
      )}
      {confirm && (
        <div
          className="artifact-quick-edit-confirm"
          role="alertdialog"
          aria-label={t('quickEdit.unsavedConfirm.title')}
          onKeyDown={(e) => { if (e.key === 'Escape' && confirm !== 'saving') { e.stopPropagation(); cancelConfirm(); } }}
        >
          <span className="artifact-quick-edit-confirm-text">{t('quickEdit.unsavedConfirm.title')}</span>
          <span className="artifact-quick-edit-confirm-actions">
            <button type="button" className="artifact-quick-edit-confirm-button" onClick={cancelConfirm} disabled={confirm === 'saving'}>
              {t('quickEdit.unsavedConfirm.cancel')}
            </button>
            <button type="button" className="artifact-quick-edit-confirm-button" onClick={discardAndSend} disabled={confirm === 'saving'}>
              {t('quickEdit.unsavedConfirm.discard')}
            </button>
            <button
              type="button"
              className="artifact-quick-edit-confirm-button is-primary"
              onClick={saveAndSend}
              disabled={confirm === 'saving'}
              aria-busy={confirm === 'saving' || undefined}
              autoFocus
            >
              {confirm === 'saving' ? <Spinner /> : null}
              {t('quickEdit.unsavedConfirm.save')}
            </button>
          </span>
        </div>
      )}
      {sendError && <div className="artifact-quick-edit-error artifact-quick-edit-hint" role="alert">{sendError}</div>}
      <div className="artifact-quick-edit-input shrink-0 flex items-end gap-[2px] bg-surface rounded-[16px]
        border-[0.5px] border-[rgba(39,39,42,0.15)] py-[8px] pl-[8px] pr-[4px]
        focus-within:border-[rgba(39,39,42,0.3)] transition-colors">
        <textarea
          ref={taRef}
          rows={1}
          value={text}
          // Chat only: the bar is a way into the chat, for questions too.
          placeholder={direct ? t('quickEdit.placeholder') : t('quickEdit.placeholderChat')}
          aria-label={t('quickEdit.inputLabel')}
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
