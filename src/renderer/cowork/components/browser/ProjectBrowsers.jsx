import { useRef, useState } from 'react';
import Ico from '../Icons';
import Button from '../ui/Button';
import Menu from '../ui/Menu';
import { closeTaskBrowser, closeTaskTab, fetchTaskBrowsers, switchTaskTab } from '../../api';

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
  const [state, setState] = useState({ loading: false, error: '', browsers: [] });
  const [open, setOpen] = useState(false);
  const buttonRef = useRef(null);

  const load = async () => {
    setState((s) => ({ ...s, loading: true, error: '' }));
    try {
      const ids = [taskId, ...tasks.map((t) => t.id).filter((id) => id !== taskId)];
      const { browsers } = await fetchTaskBrowsers(ids);
      setState({ loading: false, error: '', browsers: browsers || [] });
    } catch (err) {
      setState({ loading: false, error: err?.message || 'Couldn’t list the browsers.', browsers: [] });
    }
  };

  const act = (fn) => async () => {
    try {
      await fn();
      onChanged?.();
    } catch (err) {
      setState((s) => ({ ...s, error: err?.message || 'That didn’t work.' }));
    }
  };

  const titleOf = (id) => tasks.find((t) => t.id === id)?.title || 'Untitled task';
  const mine = state.browsers.find((b) => b.conversation_id === taskId);
  const others = state.browsers.filter((b) => b.conversation_id !== taskId);

  const items = [];
  if (state.loading) items.push({ id: 'loading', label: 'Looking…', disabled: true });
  if (state.error) items.push({ id: 'error', label: state.error, disabled: true });
  if (!state.loading) {
    items.push({ id: 'h-mine', heading: 'This task' });
    if (mine?.holder === 'human') items.push({ id: 'held', label: 'You have this browser: its tabs show when you hand it back.', disabled: true });
    (mine?.tabs || []).forEach((tab) => {
      items.push({
        id: `tab-${tab.id}`,
        icon: Ico.globe(14),
        label: tabLabel(tab),
        hint: tab.active ? 'Showing' : undefined,
        aria: tab.active ? { 'aria-current': 'page' } : undefined,
        onClick: tab.active ? undefined : act(() => switchTaskTab(taskId, tab.id)),
      });
    });
    const side = (mine?.tabs || []).filter((t) => !t.active);
    if (side.length) {
      items.push({
        id: 'close-side',
        icon: Ico.close?.(14),
        label: side.length === 1 ? 'Close the other tab (saved for later)' : `Close the other ${side.length} tabs (saved for later)`,
        onClick: act(async () => { for (const tab of side) await closeTaskTab(taskId, tab.id); }),
      });
    }
    if (!mine && !state.error) items.push({ id: 'none-mine', label: 'No browser open for this task.', disabled: true });
    (mine?.parked_tabs || []).forEach((tab, i) => {
      items.push({
        id: `parked-${i}`,
        icon: Ico.reload(14),
        label: `Reopen ${tabLabel(tab)}`,
        hint: 'Saved',
        disabled: !onReopen,
        onClick: () => onReopen?.(tab.url),
      });
    });
    if (others.length) {
      items.push({ id: 'h-others', heading: 'Other tasks in this project' });
      others.forEach((b) => {
        const count = b.tabs.length;
        items.push({
          id: `task-${b.conversation_id}`,
          icon: Ico.appWindow(14),
          label: titleOf(b.conversation_id),
          hint: count ? `${count} tab${count === 1 ? '' : 's'}` : hostOf(b.url || ''),
          submenu: [
            ...b.tabs.map((tab) => ({ id: `o-${b.conversation_id}-${tab.id}`, label: tabLabel(tab), disabled: true })),
            { id: `go-${b.conversation_id}`, label: 'Go to its browser', onClick: () => onOpenTaskBrowser?.(b.conversation_id, b.session_id) },
            {
              id: `close-${b.conversation_id}`,
              label: 'Close its browser (tabs saved)',
              danger: true,
              disabled: b.viewers > 0 || b.holder === 'human',
              title: b.viewers > 0 ? 'Someone is watching it' : undefined,
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
        aria-label="Browsers in this project"
        title="Browsers in this project"
        aria-expanded={open}
        onClick={() => { setOpen(true); void load(); }}
      >
        {Ico.appWindow(14)}
      </Button>
      <Menu
        open={open}
        anchor={buttonRef.current}
        onClose={() => setOpen(false)}
        ariaLabel="Browsers in this project"
        align="end"
        width={340}
        items={items}
      />
    </>
  );
}
