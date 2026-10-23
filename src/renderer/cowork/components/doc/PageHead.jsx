// The top of a doc's page: its title (the doc's, or the tab's in a doc with
// tabs) and the byline under it, which in a doc of one tab offers "Add tab"
// (a doc with tabs adds them from its tab rail).
import { useEffect, useRef, useState } from 'react';
import { Plus } from 'lucide-react';
import { Icon } from '../ui/Icon';
import EditableText from './EditableText';
import { relativeAge } from '../../lib/formatTime';

// "Edited 3m ago" that stays true: it re-reads the clock each minute instead of
// keeping the age it had when the doc last rendered.
function EditedAgo({ at }) {
  const [, tick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), 60_000);
    return () => clearInterval(t);
  }, []);
  return <span>{at ? `Edited ${relativeAge(at)}` : 'New doc'}</span>;
}

/**
 * `onEnter` runs when Enter leaves the title for the page. `nameNow`: this is
 * a tab just added, so its title starts selected, to be typed over; `onNamed`
 * says that has happened.
 */
export default function PageHead({ title, editable, onCommit, onEnter, updatedAt, byAgent, onAddTab, nameNow = false, onNamed }) {
  const titleRef = useRef(null);
  useEffect(() => {
    if (!nameNow) return;
    titleRef.current?.focus('all');
    onNamed?.();
  }, [nameNow, onNamed]);
  return (
    <>
      <EditableText
        ref={titleRef}
        className="doc-title"
        value={title}
        plain
        singleLine
        editable={editable}
        placeholder="Untitled"
        ariaLabel="Title"
        onCommit={onCommit}
        onKeyDown={(e) => {
          if (e.key !== 'Enter') return;
          e.preventDefault();
          e.currentTarget.blur();
          onEnter();
        }}
      />
      <div className="doc-byline">
        <EditedAgo at={updatedAt} />
        {byAgent && (<><span className="doc-byline__dot">·</span><span>Written with the agent</span></>)}
        {onAddTab && (
          <button type="button" className="doc-byline__add" onClick={onAddTab}><Icon of={Plus} size={14} />Add tab</button>
        )}
      </div>
    </>
  );
}
