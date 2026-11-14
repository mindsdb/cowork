import { useRef, useState } from 'react';
import Ico from '../Icons';
import Button from '../ui/Button';
import Menu from '../ui/Menu';
import { closeTaskBrowser, closeTaskTab, fetchTaskBrowsers, switchTaskTab } from '../../api';
import { useTranslation } from '../../../lib/i18n';

/* The project's browsers, from the browser pane's header (ENG-4138,
   prototype): this task's tabs, to switch to or close (a closed tab is
   saved, to reopen later), the tabs it saved, and the other tasks' open
   browsers in the project, to go to or close. Read each time it opens.
   Web only: the router knows which browsers are open. */

const hostOf = (url) => {
  try {
    return new URL(url).host || url;
  } catch {
    return url;
  }
};

function tabLabel(tab) {
  const title = String(tab.title || '').trim();
  return title ? `${title} · ${hostOf(tab.url)}` : hostOf(tab.url);
}

/**
 * @param {{ taskId: string, tasks: { id: string, title?: string }[],
 *   onReopen?: (url: string) => void, onOpenTaskBrowser?: (taskId: string, sessionId: string) => void,
 *   onChanged?: () => void }} props
 */
export default function ProjectBrowsers({ taskId, tasks, onReopen, onOpenTaskBrowser, onChanged }) {
  const { t } = useTranslation('chat');
  const [state, setState] = useState({ loading: false, error: '', browsers: [] });
  const [open, setOpen] = useState(false);
  const buttonRef = useRef(null);

  const load = async () => {
    setState((s) => ({ ...s, loading: true, error: '' }));
    try {
      const ids = [taskId, ...tasks.map((task) => task.id).filter((id) => id !== taskId)];
      const { browsers } = await fetchTaskBrowsers(ids);
      setState({ loading: false, error: '', browsers: browsers || [] });
    } catch (err) {
      setState({ loading: false, error: err?.message || t('browser.projectBrowsers.listFailed'), browsers: [] });
    }
  };

  const act = (fn) => async () => {
    try {
      await fn();
      onChanged?.();
    } catch (err) {
      setState((s) => ({ ...s, error: err?.message || t('browser.projectBrowsers.failed') }));
    }
  };

  const titleOf = (id) => tasks.find((task) => task.id === id)?.title || t('taskRows.untitled');
  const mine = state.browsers.find((b) => b.conversation_id === taskId);
  const others = state.browsers.filter((b) => b.conversation_id !== taskId);

  const items = [];
  if (state.loading) items.push({ id: 'loading', label: t('browser.projectBrowsers.looking'), disabled: true });
  if (state.error) items.push({ id: 'error', label: state.error, disabled: true });
  if (!state.loading) {
    items.push({ id: 'h-mine', heading: t('browser.projectBrowsers.thisTask') });
    if (mine?.holder === 'human') items.push({ id: 'held', label: t('browser.projectBrowsers.held'), disabled: true });
    (mine?.tabs || []).forEach((tab) => {
      items.push({
        id: `tab-${tab.id}`,
        icon: Ico.globe(14),
        label: tabLabel(tab),
        hint: tab.active ? t('browser.projectBrowsers.showing') : undefined,
        aria: tab.active ? { 'aria-current': 'page' } : undefined,
        onClick: tab.active ? undefined : act(() => switchTaskTab(taskId, tab.id)),
      });
    });
    const side = (mine?.tabs || []).filter((tab) => !tab.active);
    if (side.length) {
      items.push({
        id: 'close-side',
        icon: Ico.close?.(14),
        label: t('browser.projectBrowsers.closeOthers', { count: side.length }),
        onClick: act(async () => { for (const tab of side) await closeTaskTab(taskId, tab.id); }),
      });
    }
    if (!mine && !state.error) items.push({ id: 'none-mine', label: t('browser.projectBrowsers.noneMine'), disabled: true });
    (mine?.parked_tabs || []).forEach((tab, i) => {
      items.push({
        id: `parked-${i}`,
        icon: Ico.reload(14),
        label: t('browser.projectBrowsers.reopen', { tab: tabLabel(tab) }),
        hint: t('browser.projectBrowsers.saved'),
        disabled: !onReopen,
        onClick: () => onReopen?.(tab.url),
      });
    });
    if (others.length) {
      items.push({ id: 'h-others', heading: t('browser.projectBrowsers.otherTasks') });
      others.forEach((b) => {
        const count = b.tabs.length;
        items.push({
          id: `task-${b.conversation_id}`,
          icon: Ico.appWindow(14),
          label: titleOf(b.conversation_id),
          hint: count ? t('browser.projectBrowsers.tabCount', { count }) : hostOf(b.url || ''),
          submenu: [
            ...b.tabs.map((tab) => ({ id: `o-${b.conversation_id}-${tab.id}`, label: tabLabel(tab), disabled: true })),
            { id: `go-${b.conversation_id}`, label: t('browser.projectBrowsers.goTo'), onClick: () => onOpenTaskBrowser?.(b.conversation_id, b.session_id) },
            {
              id: `close-${b.conversation_id}`,
              label: t('browser.projectBrowsers.closeIts'),
              danger: true,
              disabled: b.viewers > 0 || b.holder === 'human',
              title: b.viewers > 0 ? t('browser.projectBrowsers.watching') : undefined,
              onClick: act(() => closeTaskBrowser(b.conversation_id)),
            },
          ],
        });
      });
    }
  }

  return (
    <>
      <Button
        ref={buttonRef}
        icon
        size="sm"
        variant="subtle"
        aria-label={t('browser.projectBrowsers.title')}
        title={t('browser.projectBrowsers.title')}
        aria-expanded={open}
        onClick={() => { setOpen(true); void load(); }}
      >
        {Ico.appWindow(14)}
      </Button>
      <Menu
        open={open}
        anchor={buttonRef.current}
        onClose={() => setOpen(false)}
        ariaLabel={t('browser.projectBrowsers.title')}
        align="end"
        width={340}
        items={items}
      />
    </>
  );
}
