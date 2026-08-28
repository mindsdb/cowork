import { useState } from 'react';
import Ico from '../../Icons';
import { Button } from '../../ui';

export function TextSelectionComment({ selection, onCancel, onCreate }) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  if (!selection) return null;

  // `finally`, because the composer is disabled while busy: a rejecting
  // `onCreate` would otherwise leave the button dead for good, with the typed
  // comment unsent and no way back but reselecting the text.
  const submit = async () => {
    if (!text.trim() || busy) return;
    setBusy(true);
    try {
      const ok = await onCreate?.({
        selector: JSON.stringify(selection),
        text: text.trim(),
        kind: 'review',
      });
      if (ok) onCancel?.();
    } catch {
      // `onCreate` is contracted to report its own failures (the comments hook
      // turns them into the panel's error line) and answer false, so a throw
      // is unexpected: keep the composer open with the text intact and let the
      // user retry rather than swallow the draft.
    } finally {
      setBusy(false);
    }
  };

  return (
    <aside className="artifact-selection-comment" aria-label="Comment on selected text">
      <div className="artifact-selection-quote">“{selection.quote}”</div>
      <textarea
        autoFocus
        rows={2}
        value={text}
        placeholder="What should change here?"
        aria-label="Comment on selected text"
        onChange={(event) => setText(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Escape') onCancel?.();
          if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) submit();
        }}
      />
      <div>
        <Button variant="ghost" onClick={onCancel}>Cancel</Button>
        <Button disabled={!text.trim() || busy} onClick={submit}>
          {Ico.send(13)} Comment
        </Button>
      </div>
    </aside>
  );
}

export default TextSelectionComment;
