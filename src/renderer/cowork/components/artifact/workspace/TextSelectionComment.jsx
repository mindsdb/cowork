import { useState } from 'react';
import Ico from '../../Icons';
import { Button } from '../../ui';

export function TextSelectionComment({ selection, onCancel, onCreate }) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  if (!selection) return null;

  // Reset busy in finally so a rejected onCreate leaves the typed comment available for retry.
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
      // Unexpected onCreate throws preserve the open composer and draft for retry; normal failures
      // are reported by the comments hook.
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
