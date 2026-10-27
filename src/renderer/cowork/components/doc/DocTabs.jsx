// A doc's tabs as a tablist: the rail beside the page, where an editor can
// also rename, move and delete tabs, and the strip above the page where the
// rail has no room. Each is one tab stop; the arrow keys, Home and End
// move between tabs and open them. The rail folds away, as the app's sidebar
// does, and stays folded for the next doc (useTabsHidden).
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Ellipsis, PanelLeftClose, Plus } from 'lucide-react';
import { Icon } from '../ui/Icon';
import { Menu, Tooltip } from '../ui';

const TABS_HIDDEN_KEY = 'cowork:doc-tabs-hidden:v1';

function readTabsHidden() {
  try {
    return window.localStorage.getItem(TABS_HIDDEN_KEY) === '1';
  } catch {
    return false;
  }
}

/** Whether the person has folded the tab rail away: [hidden, setHidden], kept for the next doc. */
export function useTabsHidden() {
  const [hidden, setHiddenState] = useState(readTabsHidden);
  const setHidden = useCallback((next) => {
    setHiddenState(next);
    try {
      window.localStorage.setItem(TABS_HIDDEN_KEY, next ? '1' : '0');
    } catch { /* private mode or blocked storage: it holds for this session */ }
  }, []);
  return [hidden, setHidden];
}
import { opIndex } from './docModel';

/** Where an arrow, Home or End key moves from tab `index` of `count`; null for any other key. */
export function tabKeyTarget(key, index, count, vertical) {
  if (key === (vertical ? 'ArrowUp' : 'ArrowLeft')) return (index - 1 + count) % count;
  if (key === (vertical ? 'ArrowDown' : 'ArrowRight')) return (index + 1) % count;
  if (key === 'Home') return 0;
  if (key === 'End') return count - 1;
  return null;
}

/** The id of tab `tabId`'s element; the page gives `${idBase}-panel` to its tabpanel. */
export const tabElementId = (idBase, tabId) => `${idBase}-tab-${tabId}`;

/** The tablist's keydown: arrows, Home and End move the focus to a tab and open it. */
function tabKeys({ tabs, activeId, onSelect, idBase, vertical }) {
  return (e) => {
    const index = tabs.findIndex((t) => tabElementId(idBase, t.id) === e.target.id);
    const to = index < 0 ? null : tabKeyTarget(e.key, index, tabs.length, vertical);
    if (to == null) return;
    e.preventDefault();
    document.getElementById(tabElementId(idBase, tabs[to].id))?.focus();
    if (tabs[to].id !== activeId) onSelect(tabs[to].id);
  };
}

const tabProps = (idBase, t, activeId) => ({
  id: tabElementId(idBase, t.id),
  role: 'tab',
  'aria-selected': t.id === activeId,
  'aria-controls': `${idBase}-panel`,
  tabIndex: t.id === activeId ? 0 : -1,
});

/**
 * The changed tabs past the strip's ends: of `dots` (each changed tab's dot,
 * {id, left, right}, in order), the nearest past each end of `box`, or null.
 */
export function changedOffside(box, dots) {
  return {
    left: dots.filter((d) => d.left < box.left - 1).at(-1)?.id ?? null,
    right: dots.find((d) => d.right > box.right + 1)?.id ?? null,
  };
}

/** The strip: the tabs in a row, and `onAdd`'s + after them for an editor; `unseen`, as the rail's. */
export function TabStrip({ tabs, activeId, onSelect, idBase, onAdd, unseen }) {
  const onKeyDown = tabKeys({ tabs, activeId, onSelect, idBase, vertical: false });
  // A strip with more tabs than room scrolls, and a changed tab past its end
  // kept its dot out of sight (found in the packaged app). That end shows the
  // dot then, and brings the tab into view.
  const listRef = useRef(null);
  const [offside, setOffside] = useState({ left: null, right: null });
  const measure = useCallback(() => {
    const list = listRef.current;
    if (!list) return;
    const dots = [...list.querySelectorAll('.doc-tab__dot')].map((dot) => {
      const r = dot.getBoundingClientRect();
      return { id: dot.closest('[role="tab"]').id, left: r.left, right: r.right };
    });
    const next = changedOffside(list.getBoundingClientRect(), dots);
    setOffside((was) => (was.left === next.left && was.right === next.right ? was : next));
  }, []);
  useLayoutEffect(measure, [measure, tabs, unseen, activeId]);
  useEffect(() => {
    const list = listRef.current;
    list.addEventListener('scroll', measure, { passive: true });
    const ro = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure);
    ro?.observe(list);
    return () => { list.removeEventListener('scroll', measure); ro?.disconnect(); };
  }, [measure]);
  const edge = (side) => offside[side] && (
    <button type="button" className="doc-tabstrip__more" aria-label="Show the changed tab"
      onClick={() => document.getElementById(offside[side])?.scrollIntoView({ block: 'nearest', inline: 'nearest' })}>
      <span className="doc-tab__dot" aria-hidden="true" />
    </button>
  );
  return (
    <div className="doc-tabstrip">
      {edge('left')}
      <div className="doc-tabstrip__tabs" ref={listRef} role="tablist" aria-label="Tabs" onKeyDown={onKeyDown}>
        {tabs.map((t) => (
          <button key={t.id} type="button" className="doc-tab" {...tabProps(idBase, t, activeId)} onClick={() => onSelect(t.id)}>
            <span className="doc-tab__title">{t.title}</span>
            {unseen?.has(t.id) && t.id !== activeId && <span className="doc-tab__dot" aria-label="Changed" />}
          </button>
        ))}
      </div>
      {edge('right')}
      {onAdd && (
        <button type="button" className="doc-tabstrip__add" aria-label="Add tab" onClick={onAdd}><Icon of={Plus} size={14} /></button>
      )}
    </div>
  );
}

/**
 * The rail. Each row holds its tab and, beside it, the tab's name box while
 * it is renamed (double-click or F2) and its options menu; `apply` sends the
 * tab ops, `unseen` holds the tabs the agent changed out of sight. `onHide`
 * folds it away; `hidden`, it is folded, and out of reach of keys and readers.
 */
export function TabRail({ tabs, activeId, unseen, editable, onSelect, apply, idBase, hidden = false, onHide }) {
  const [renaming, setRenaming] = useState(null);
  const [menuFor, setMenuFor] = useState(null);
  const arrows = tabKeys({ tabs, activeId, onSelect, idBase, vertical: true });
  const add = async () => {
    const before = new Set(tabs.map((t) => t.id));
    const res = await apply([{ op: 'add_tab', title: 'Untitled' }]);
    const created = res?.doc?.tabs?.find((t) => !before.has(t.id));
    if (created) { onSelect(created.id); setRenaming(created.id); }
  };
  const onKeyDown = (e) => {
    const t = tabs.find((x) => tabElementId(idBase, x.id) === e.target.id);
    if (t && e.key === 'F2' && editable) { e.preventDefault(); setRenaming(t.id); return; }
    arrows(e);
  };
  const rename = (t, value) => {
    setRenaming(null);
    const v = value.trim();
    if (v && v !== t.title) apply([{ op: 'rename_tab', tab: t.id, title: v }]);
  };
  return (
    <nav className="doc-tabs" aria-label="Tabs" data-hidden={hidden || undefined} aria-hidden={hidden || undefined}
      inert={hidden ? true : undefined}>
      <div className="doc-tabs__head">
        <div className="doc-tabs__label">Tabs</div>
        {onHide && (
          <Tooltip content="Hide tabs">
            <button type="button" className="doc-tabs__hide" aria-label="Hide tabs" onClick={onHide}>
              <Icon of={PanelLeftClose} size={16} />
            </button>
          </Tooltip>
        )}
      </div>
      <div className="doc-tabs__list" role="tablist" aria-orientation="vertical" aria-label="Tabs" onKeyDown={onKeyDown}>
        {tabs.map((t, i) => (
          <div key={t.id} role="presentation" className="doc-tab" data-selected={t.id === activeId}
            onClick={() => onSelect(t.id)}
            onDoubleClick={() => editable && setRenaming(t.id)}>
            {renaming === t.id ? (
              <input className="doc-tab__input" autoFocus defaultValue={t.title} aria-label="Tab name"
                // The name selected, so a new tab's "Untitled" is typed over.
                onFocus={(e) => e.currentTarget.select()}
                onClick={(e) => e.stopPropagation()}
                onBlur={(e) => rename(t, e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); if (e.key === 'Escape') setRenaming(null); }} />
            ) : (
              <button type="button" className="doc-tab__title" {...tabProps(idBase, t, activeId)}>{t.title}</button>
            )}
            {unseen.has(t.id) && t.id !== activeId && <span className="doc-tab__dot" aria-label="Changed" />}
            {editable && (
              <span className="doc-tab__more" onClick={(e) => e.stopPropagation()}>
                <Menu
                  open={menuFor === t.id}
                  onOpenChange={(o) => setMenuFor(o ? t.id : null)}
                  ariaLabel={`${t.title} tab`}
                  trigger={<button type="button" className="doc-gutter__btn" aria-label={`${t.title} options`}><Icon of={Ellipsis} size={14} /></button>}
                  items={[
                    { key: 'rename', label: 'Rename', onClick: () => setRenaming(t.id) },
                    ...(i > 0 ? [{ key: 'up', label: 'Move up', onClick: () => apply([{ op: 'move_tab', tab: t.id, index: opIndex(i - 1) }]) }] : []),
                    ...(i < tabs.length - 1 ? [{ key: 'down', label: 'Move down', onClick: () => apply([{ op: 'move_tab', tab: t.id, index: opIndex(i + 1) }]) }] : []),
                    ...(tabs.length > 1 ? [{ divider: true }, { key: 'del', danger: true, label: 'Delete tab', onClick: () => { apply([{ op: 'delete_tab', tab: t.id }]); if (t.id === activeId) onSelect(tabs[i === 0 ? 1 : 0].id); } }] : []),
                  ]}
                />
              </span>
            )}
          </div>
        ))}
      </div>
      {editable && (
        <button type="button" className="doc-tabs__add" onClick={add}><Icon of={Plus} size={14} /> Add tab</button>
      )}
    </nav>
  );
}
