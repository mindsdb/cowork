// EditableText — an uncontrolled contentEditable over inline Markdown.
//
// React never owns the DOM inside it: the HTML is written on mount and again
// only when `value` changes from outside while the person is not mid-edit, so
// the caret never jumps under their fingers. Edits are serialised back to
// inline Markdown and committed on a short debounce, on blur, and whenever the
// parent asks (`flush` through the handle). Typed text not yet committed is
// reported as pending to the editor's save indicator (PendingEdits).
// `onCommit` may return false to refuse a value (an emptied name): the field
// keeps it while the person is in it and shows the last good value after.
import { forwardRef, useCallback, useEffect, useImperativeHandle, useLayoutEffect, useRef } from 'react';
import { escapeHtml, htmlToInline, inlineToHtml } from './docModel';
import { caretOffset, placeCaret } from './caret';
import { useFlushOnUnmount, usePendingEdit } from './useSaveIndicator';

export const COMMIT_MS = 450;

const EditableText = forwardRef(function EditableText(
  {
    value,
    onCommit,
    onKeyDown,
    onInput,
    onPaste,
    onPasteImages,
    onFocus,
    onBlur,
    placeholder = '',
    editable = true,
    className = '',
    plain = false,
    as: Tag = 'div',
    ariaLabel,
    singleLine = false,
    dataBlock,
    aria,
  },
  ref,
) {
  const el = useRef(null);
  const timer = useRef(null);
  const lastValue = useRef(value);
  const refused = useRef(false);
  const { dirty, setDirty } = usePendingEdit();

  const read = useCallback(() => {
    if (!el.current) return '';
    return plain ? (el.current.textContent || '').replace(/\u00a0/g, ' ') : htmlToInline(el.current);
  }, [plain]);

  const markEmpty = useCallback(() => {
    if (!el.current) return;
    const empty = !(el.current.textContent || '').length && !el.current.querySelector('[data-chip],img,br + *');
    el.current.dataset.empty = empty ? 'true' : 'false';
  }, []);

  const write = useCallback((v) => {
    if (!el.current) return;
    el.current.innerHTML = plain ? escapeHtml(v) : inlineToHtml(v);
    markEmpty();
  }, [plain, markEmpty]);

  const cancelCommit = () => {
    clearTimeout(timer.current);
    timer.current = null;
  };

  // The latest onCommit, read when a commit fires: parents pass a new one each
  // render, and flush (so the handle) should not change with it.
  const commit = useRef(onCommit);
  useLayoutEffect(() => { commit.current = onCommit; });

  /** Commit what was typed; `leaving` (blur) also undoes a refused value. */
  const flush = useCallback((leaving = false) => {
    cancelCommit();
    if (dirty.current) {
      setDirty(false);
      const next = read();
      refused.current = next !== lastValue.current && commit.current?.(next) === false;
      if (!refused.current) lastValue.current = next;
    }
    if (leaving && refused.current) {
      refused.current = false;
      write(lastValue.current);
    }
  }, [read, dirty, setDirty, write]);

  useLayoutEffect(() => {
    write(value);
    lastValue.current = value;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (value === lastValue.current) return;
    if (dirty.current && el.current && document.activeElement === el.current) return; // their edit wins
    const focused = el.current && document.activeElement === el.current;
    const offset = focused ? caretOffset(el.current) : null;
    write(value);
    lastValue.current = value;
    if (focused && offset != null) placeCaret(el.current, Math.min(offset, (el.current.textContent || '').length));
  }, [value, write]);

  useFlushOnUnmount(flush);

  useImperativeHandle(ref, () => ({
    el: () => el.current,
    flush,
    read,
    /** Replace the content now (structural edits: split, merge, type change). */
    set: (v) => {
      cancelCommit();
      setDirty(false);
      refused.current = false;
      lastValue.current = v;
      write(v);
    },
    /** Drop typed text not yet committed: a structural edit has taken it elsewhere. */
    discard: () => {
      cancelCommit();
      setDirty(false);
      refused.current = false;
    },
    focus: (where = 'end') => placeCaret(el.current, where),
  }), [flush, read, write, setDirty]);

  const handleInput = (e) => {
    setDirty(true);
    markEmpty();
    clearTimeout(timer.current);
    timer.current = setTimeout(() => flush(), COMMIT_MS);
    onInput?.(e, { read, el: el.current });
  };

  const handlePaste = (e) => {
    const images = [...(e.clipboardData?.files || [])].filter((f) => f.type.startsWith('image/'));
    if (images.length && onPasteImages) {
      e.preventDefault();
      onPasteImages(images);
      return;
    }
    const text = e.clipboardData?.getData('text/plain') ?? '';
    if (onPaste && onPaste(e, text)) return;
    e.preventDefault();
    const clean = singleLine ? text.replace(/\s*\n+\s*/g, ' ') : text;
    document.execCommand('insertText', false, clean);
  };

  return (
    <Tag
      ref={el}
      className={`doc-editable ${className}`}
      contentEditable={editable ? 'true' : 'false'}
      suppressContentEditableWarning
      spellCheck={editable}
      role={editable ? 'textbox' : undefined}
      aria-multiline={editable && !singleLine ? 'true' : undefined}
      aria-label={ariaLabel}
      {...aria}
      data-placeholder={placeholder}
      data-block={dataBlock}
      onInput={editable ? handleInput : undefined}
      onKeyDown={editable ? (e) => onKeyDown?.(e, { flush, read, el: el.current }) : undefined}
      onPaste={editable ? handlePaste : undefined}
      onFocus={onFocus}
      onBlur={(e) => {
        flush(true);
        onBlur?.(e);
      }}
    />
  );
});

export default EditableText;
