// The top of a doc's page: its title (the doc's, or the tab's in a doc with
// tabs) and the byline under it, which in a doc of one tab offers "Add tab"
// (a doc with tabs adds them from its tab rail).
import { useEffect, useRef, useState } from 'react';
import { Plus } from 'lucide-react';
import { Icon } from '../ui/Icon';
import EditableText from './EditableText';
import { relativeAge } from '../../lib/formatTime';
import { useTranslation } from '../../../lib/i18n';

// "Edited 3m ago" that stays true: it re-reads the clock each minute instead of
// keeping the age it had when the doc last rendered.
function EditedAgo({ at }) {
  const { t } = useTranslation('docs');
  const [, tick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), 60_000);
    return () => clearInterval(t);
  }, []);
  return <span>{at ? t('page.edited', { age: relativeAge(at) }) : t('page.new')}</span>;
}

/**
 * `onEnter` runs when Enter leaves the title for the page. `nameNow`: this is
 * a tab just added, so its title starts selected, to be typed over; `onNamed`
 * says that has happened.
 */
export default function PageHead({ title, editable, onCommit, onEnter, updatedAt, byAgent, onAddTab, nameNow = false, onNamed }) {
  const { t } = useTranslation('docs');
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
        placeholder={t('page.untitled')}
        ariaLabel={t('page.title')}
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
        {byAgent && (<><span className="doc-byline__dot">·</span><span>{t('page.byAgent')}</span></>)}
        {onAddTab && (
          <button type="button" className="doc-byline__add" onClick={onAddTab}><Icon of={Plus} size={14} />{t('tabs.add')}</button>
        )}
      </div>
    </>
  );
}
