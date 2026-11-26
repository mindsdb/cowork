// The doc's name in the pane's header. Where the doc can be edited it is the
// way to rename the doc at any number of tabs (the page's title names the tab
// once there are two or more): a click turns it into a field, its text
// selected; Enter or leaving the field renames, Escape puts the name back.
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from '../../../lib/i18n';

export default function DocHeaderTitle({ title, onRename }) {
  const { t } = useTranslation('docs');
  // The name the field opened with, null while it is closed: left as it was,
  // the field renames nothing, even if the agent renamed the doc meanwhile.
  const [openedWith, setOpenedWith] = useState(null);
  // Enter or Escape gives the focus back to the name; a click elsewhere keeps it there.
  const refocus = useRef(false);
  // Edit rights gone (or a past version shown) close the field without a blur.
  useEffect(() => { if (!onRename) setOpenedWith(null); }, [onRename]);

  if (!onRename) return <span className="doc-header__title" title={title}>{title}</span>;
  if (openedWith !== null) {
    return (
      <input
        className="doc-header__title doc-header__title-input"
        autoFocus
        defaultValue={title}
        aria-label={t('pane.docName')}
        onFocus={(e) => e.currentTarget.select()}
        onBlur={(e) => {
          setOpenedWith(null);
          const next = e.currentTarget.value.trim();
          // A doc keeps a name: emptied, the old one comes back.
          if (next && next !== openedWith && next !== title) onRename(next);
        }}
        onKeyDown={(e) => {
          if (e.nativeEvent.isComposing) return;
          if (e.key !== 'Enter' && e.key !== 'Escape') return;
          e.preventDefault();
          // Escape here cancels the rename, never closes the preview around the doc.
          e.stopPropagation();
          if (e.key === 'Escape') e.currentTarget.value = openedWith;
          refocus.current = true;
          e.currentTarget.blur();
        }}
      />
    );
  }
  return (
    <button
      ref={(el) => {
        if (!el || !refocus.current) return;
        refocus.current = false;
        el.focus();
      }}
      type="button"
      className="doc-header__title doc-header__title--editable"
      title={title}
      aria-label={t('pane.renameDoc', { title })}
      onClick={() => setOpenedWith(title)}
    >
      {title}
    </button>
  );
}
