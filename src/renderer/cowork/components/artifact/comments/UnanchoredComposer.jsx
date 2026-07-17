// Pinned composer at the bottom of the comments inbox — creates UNANCHORED
// (general) threads: comments not attached to any element on the page
// (selector: null). Anchored comments are still created on the artifact via
// comment mode; this is the only UI path that posts without a selector.
//
// Enter posts, Shift+Enter inserts a newline. On failure the draft stays in
// the field (the hook surfaces the error banner) so the user can retry.

import { useCallback, useRef, useState } from 'react';
import { ArrowUpIcon } from './icons';

const MAX_HEIGHT = 120; // px — ~5 lines before the textarea scrolls

export function UnanchoredComposer({ onCreate, onPosted }) {
  const [text, setText] = useState('');
  const [pending, setPending] = useState(false);
  const taRef = useRef(null);

  const grow = useCallback(() => {
    const ta = taRef.current;
    if (!ta) return;
    ta.style.height = 'auto';
    const h = Math.min(MAX_HEIGHT, ta.scrollHeight);
    ta.style.height = `${h}px`;
    ta.style.overflowY = ta.scrollHeight > MAX_HEIGHT ? 'auto' : 'hidden';
  }, []);

  const canSend = !pending && !!text.trim();

  const send = useCallback(async () => {
    if (pending || !text.trim()) return;
    setPending(true);
    const ok = await onCreate?.({ selector: null, text });
    setPending(false);
    if (ok) {
      setText('');
      requestAnimationFrame(grow);
      onPosted?.();
      taRef.current?.focus();
    }
  }, [pending, text, onCreate, onPosted, grow]);

  return (
    <div className="shrink-0 flex items-end gap-[2px] bg-white rounded-[16px]
      border-[0.5px] border-[rgba(39,39,42,0.15)] py-[8px] pl-[8px] pr-[4px]
      focus-within:border-[rgba(39,39,42,0.3)] transition-colors">
      <textarea
        ref={taRef}
        rows={1}
        value={text}
        placeholder="Add a comment…"
        aria-label="Add a comment"
        disabled={pending}
        className="flex-1 min-w-0 resize-none outline-none border-0 bg-transparent
          text-[14px] leading-[24px] text-[#111115] placeholder-[#828285] px-[4px]"
        style={{ fontFamily: 'inherit', height: 24, overflowY: 'hidden' }}
        onChange={(e) => { setText(e.target.value); requestAnimationFrame(grow); }}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
        }}
      />
      <button
        type="button"
        aria-label="Send"
        title="Send"
        disabled={!canSend}
        onClick={send}
        className={[
          'w-[24px] h-[24px] rounded-full flex items-center justify-center shrink-0',
          'border-0 p-0 transition-[background,opacity,transform] active:scale-[.92]',
          canSend
            ? 'bg-[#146573] text-white opacity-100 cursor-pointer'
            : 'bg-transparent text-[#111115] opacity-45 cursor-default',
        ].join(' ')}
      >
        <ArrowUpIcon />
      </button>
    </div>
  );
}

export default UnanchoredComposer;
