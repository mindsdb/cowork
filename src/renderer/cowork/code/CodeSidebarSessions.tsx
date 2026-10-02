import { useEffect, useMemo, useState } from 'react';

import Ico from '../components/Icons';
import Button from '../components/ui/Button';
import { Collapsible } from '../components/ui/Collapsible';
import Menu from '../components/ui/Menu';
import type { CodingSession } from './api';
import { codingSessionStatus, relativeTime, repositoryLabel } from './presentation';
import { useTaskSeen } from './taskSeen';


type Organization = 'project' | 'list';
type SortOrder = 'priority' | 'updated';

const PREFERENCES_KEY = 'cowork:code-task-navigation:v1';

function initialPreferences(): { organization: Organization; sortOrder: SortOrder } {
  try {
    const stored = JSON.parse(window.localStorage.getItem(PREFERENCES_KEY) || '{}');
    return {
      organization: stored.organization === 'project' ? 'project' : 'list',
      sortOrder: stored.sortOrder === 'updated' ? 'updated' : 'priority',
    };
  } catch {
    return { organization: 'list', sortOrder: 'priority' };
  }
}

function priority(session: CodingSession): number {
  const tone = codingSessionStatus(session).tone;
  if (tone === 'warning' || tone === 'danger') return 0;
  if (tone === 'accent') return 1;
  return 2;
}

function compareSessions(left: CodingSession, right: CodingSession, sortOrder: SortOrder): number {
  const priorityDelta = sortOrder === 'priority' ? priority(left) - priority(right) : 0;
  return priorityDelta || Date.parse(right.updated_at) - Date.parse(left.updated_at);
}

function projectLabel(session: CodingSession): string {
  return session.project_name?.trim() || 'No project';
}

function matchesSession(session: CodingSession, normalizedQuery: string): boolean {
  if (!normalizedQuery) return true;
  return `${session.title} ${repositoryLabel(session)} ${projectLabel(session)}`
    .toLowerCase()
    .includes(normalizedQuery);
}

export function CodeSidebarSessions({
  sessions,
  selectedId,
  onSelect,
  onSetPinned,
}: {
  sessions: CodingSession[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onSetPinned: (id: string, pinned: boolean) => Promise<void>;
}) {
  const preferences = useMemo(initialPreferences, []);
  const isUnread = useTaskSeen(sessions, selectedId);
  const [organization, setOrganization] = useState<Organization>(preferences.organization);
  const [sortOrder, setSortOrder] = useState<SortOrder>(preferences.sortOrder);
  const [query, setQuery] = useState('');
  const [pinOverrides, setPinOverrides] = useState<Record<string, boolean>>({});
  const [pinBusy, setPinBusy] = useState<Set<string>>(() => new Set());
  const [pinError, setPinError] = useState<string | null>(null);

  useEffect(() => {
    setPinOverrides((current) => {
      const next = { ...current };
      let changed = false;
      sessions.forEach((session) => {
        if (session.id in next && Boolean(session.pinned) === next[session.id]) {
          delete next[session.id];
          changed = true;
        }
      });
      return changed ? next : current;
    });
  }, [sessions]);

  const updatePreference = (nextOrganization: Organization, nextSortOrder: SortOrder) => {
    setOrganization(nextOrganization);
    setSortOrder(nextSortOrder);
    try {
      window.localStorage.setItem(PREFERENCES_KEY, JSON.stringify({
        organization: nextOrganization,
        sortOrder: nextSortOrder,
      }));
    } catch {
      // The preference remains valid for this window when storage is unavailable.
    }
  };

  const normalizedQuery = query.trim().toLowerCase();
  const visibleSessions = useMemo(() => sessions.map((session) => (
    session.id in pinOverrides ? { ...session, pinned: pinOverrides[session.id] } : session
  )), [pinOverrides, sessions]);
  const ordered = useMemo(() => visibleSessions
    .filter((session) => !session.archived && matchesSession(session, normalizedQuery))
    .sort((left, right) => compareSessions(left, right, sortOrder)), [normalizedQuery, sortOrder, visibleSessions]);
  const pinned = ordered.filter((session) => session.pinned);
  const unpinned = ordered.filter((session) => !session.pinned);
  const archived = useMemo(() => visibleSessions
    .filter((session) => session.archived && matchesSession(session, normalizedQuery))
    .sort((left, right) => Date.parse(right.updated_at) - Date.parse(left.updated_at)), [normalizedQuery, visibleSessions]);
  // Archived stays folded until you open it, or until the selected task is one of them.
  const selectedArchived = archived.some((session) => session.id === selectedId);
  const [archivedOpen, setArchivedOpen] = useState(selectedArchived);
  useEffect(() => {
    if (selectedArchived) setArchivedOpen(true);
  }, [selectedArchived]);

  const projectGroups = new Map<string, CodingSession[]>();
  unpinned.forEach((session) => {
    const label = projectLabel(session);
    projectGroups.set(label, [...(projectGroups.get(label) || []), session]);
  });
  const projects = [...projectGroups.entries()];

  const togglePinned = async (session: CodingSession) => {
    if (pinBusy.has(session.id)) return;
    const nextPinned = !session.pinned;
    setPinError(null);
    setPinOverrides((current) => ({ ...current, [session.id]: nextPinned }));
    setPinBusy((current) => new Set(current).add(session.id));
    try {
      await onSetPinned(session.id, nextPinned);
    } catch {
      setPinOverrides((current) => {
        const next = { ...current };
        delete next[session.id];
        return next;
      });
      setPinError(`Couldn't ${nextPinned ? 'pin' : 'unpin'} this task.`);
    } finally {
      setPinBusy((current) => {
        const next = new Set(current);
        next.delete(session.id);
        return next;
      });
    }
  };

  const sessionRow = (session: CodingSession) => {
    const status = codingSessionStatus(session);
    const repository = repositoryLabel(session);
    const updated = relativeTime(session.updated_at);
    const isPinned = Boolean(session.pinned);
    const unread = isUnread(session);
    // Colour and a label are kept for work in motion and for what needs the
    // user; a finished task only earns a mark until it has been seen.
    const working = status.tone === 'accent';
    const needsYou = status.tone === 'warning' || status.tone === 'danger';
    const resting = !working && !needsYou && !unread;
    return (
      <div
        key={session.id}
        className={`code-sidebar-session-row${selectedId === session.id ? ' is-selected' : ''}${isPinned ? ' is-pinned' : ''}${resting ? ' is-resting' : ''}`}
      >
        {/* One line, like Cowork's recent rows: the title, then the live
            status (a spinner while it runs, or what needs you in its colour) or, at rest,
            when it last changed. The project is left to the tooltip and
            accessible name: rows mostly share one, and Organize › Projects
            groups by it. */}
        <button
          type="button"
          className="code-sidebar-session"
          onClick={() => onSelect(session.id)}
          aria-current={selectedId === session.id ? 'page' : undefined}
          aria-label={`${session.title || 'Untitled coding task'}, ${status.label}${unread ? ', unread' : ''}, ${repository}, ${updated}`}
          title={`${session.title || 'Untitled coding task'} · ${repository}`}
        >
          <span className="code-sidebar-session__title">{session.title || 'Untitled coding task'}</span>
          <span className={`code-sidebar-session__aside${needsYou ? ` is-${status.tone}` : ''}`}>
            {working && <span className="code-sidebar-session__spinner" aria-hidden="true" />}
            {!working && needsYou && <span className={`code-status-dot is-${status.tone}`} aria-hidden="true" />}
            {!working && !needsYou && unread && <span className="code-status-dot is-unread" aria-hidden="true" />}
            {!working && <span className="code-sidebar-session__aside-label">{needsYou ? status.label : updated}</span>}
          </span>
        </button>
        <Button
          icon
          size="xxs"
          variant="subtle"
          className="code-sidebar-session__pin"
          disabled={pinBusy.has(session.id)}
          onClick={() => void togglePinned(session)}
          aria-label={`${isPinned ? 'Unpin' : 'Pin'} ${session.title || 'untitled coding task'}`}
          aria-pressed={isPinned}
          title={isPinned ? 'Unpin task' : 'Pin task'}
        >
          {Ico.pin(12)}
        </Button>
      </div>
    );
  };

  const sessionGroup = (label: string, items: CodingSession[]) => items.length ? (
    <section className="code-sidebar-session-group" key={label} aria-label={label}>
      <div className="code-sidebar-session-group__label"><span>{label}</span><b>{items.length}</b></div>
      {items.map(sessionRow)}
    </section>
  ) : null;

  const menuItems = [
    { heading: <span className="code-sidebar-organize-menu__heading">Organize</span>, id: 'organize-heading' },
    {
      id: 'organize-project', icon: Ico.folder(13), label: 'Projects', hint: organization === 'project' ? '✓' : undefined,
      aria: { 'aria-current': organization === 'project' ? 'true' : undefined },
      onClick: () => updatePreference('project', sortOrder),
    },
    {
      id: 'organize-list', icon: Ico.list(13), label: 'Task list', hint: organization === 'list' ? '✓' : undefined,
      aria: { 'aria-current': organization === 'list' ? 'true' : undefined },
      onClick: () => updatePreference('list', sortOrder),
    },
    { separator: true, id: 'organize-separator' },
    { heading: <span className="code-sidebar-organize-menu__heading">Sort</span>, id: 'sort-heading' },
    {
      id: 'sort-priority', icon: Ico.slider(13), label: 'Priority', hint: sortOrder === 'priority' ? '✓' : undefined,
      aria: { 'aria-current': sortOrder === 'priority' ? 'true' : undefined },
      onClick: () => updatePreference(organization, 'priority'),
    },
    {
      id: 'sort-updated', icon: Ico.clock(13), label: 'Last updated', hint: sortOrder === 'updated' ? '✓' : undefined,
      aria: { 'aria-current': sortOrder === 'updated' ? 'true' : undefined },
      onClick: () => updatePreference(organization, 'updated'),
    },
  ];

  return (
    <div className="code-sidebar-sessions">
      <div className="section-label code-sidebar-sessions__label">
        <span>Code tasks</span>
        <Menu
          trigger={(
            <Button size="xxs" variant="subtle" className="code-sidebar-organize-trigger" aria-label="Organize coding tasks">
              {Ico.slider(11)}<span>Organize</span>
            </Button>
          )}
          items={menuItems}
          side="bottom"
          align="end"
          width={190}
          ariaLabel="Organize coding tasks"
        />
      </div>
      {sessions.length >= 5 && (
        <label className="code-sidebar-session-search">
          <span aria-hidden="true">{Ico.search(12)}</span>
          <input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Find a task" aria-label="Find a coding task" />
        </label>
      )}
      {pinError && <div className="code-sidebar-sessions__error" role="status">{pinError}</div>}
      <div className="scroll-clean code-sidebar-sessions__list">
        {ordered.length === 0 && archived.length === 0 && (
          <div className="code-sidebar-sessions__empty">
            {normalizedQuery ? 'No coding tasks match your search.' : 'Start a coding task to keep its conversation and changes here.'}
          </div>
        )}
        {sessionGroup('Pinned', pinned)}
        {organization === 'project'
          ? projects.map(([label, items]) => sessionGroup(label, items))
          // One list either way: priority order already puts what needs you
          // first and work in motion next, and each row's status shows why.
          : unpinned.map(sessionRow)}
        {archived.length > 0 && (
          <Collapsible
            open={archivedOpen}
            onOpenChange={setArchivedOpen}
            className="code-sidebar-archived"
            triggerClassName="code-sidebar-archived__trigger"
            panelClassName="code-sidebar-archived__panel"
            title={<span className="code-disclosure-title"><span>Archived</span><small>{archived.length}</small></span>}
          >
            {archived.map(sessionRow)}
          </Collapsible>
        )}
      </div>
    </div>
  );
}
