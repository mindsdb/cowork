// `<RecipientField>` — who to share with (ENG-3787), the way Google Drive's
// share dialog asks: a search input on top and, once it is clicked or
// focused, a dropdown anchored right under it that lists everyone it could
// add, grouped: the caller's Teams, then the People in ‹org›. The recipients
// picked so far sit below as a list of rows (`<RecipientRow>`), newest on
// top, each with its own remove ×.
//
// Recipients come in three kinds, kept apart in `value`:
//   - teams (`teamIds`) — the caller's own MindsHub teams, the org's default
//     team left out ("Everyone at ‹org›" is that choice);
//   - people in the org (`userIds`) — from the org's directory, read once
//     per session (`useOrgDirectory`) and named afterwards by `useKnownPeople`;
//   - outside emails (`emails`) — only with `allowExternal`.
// With `emailsOnly` (no org) it is just addresses, with no dropdown.
//
// Typing filters the lists locally (name, email or team name; case and
// accents ignored), with no request per keystroke. Only when the hub sent a
// truncated directory does a typed query of two or more characters also ask
// the hub (`searchHubPeople`, debounced), merging what it finds into People.
// A typed email nobody in the org has becomes "Invite …" when outside emails
// are allowed. ↑/↓ move across both groups, Enter / Tab / comma add the
// highlighted (or top) row, Escape closes; the input keeps the focus, so one
// can keep typing and adding. A paste of several addresses adds each.
//
// The dropdown is portalled to the body and placed under the input with
// fixed coordinates, so it floats over whatever is below (a popover's
// footer, the rest of a form) rather than pushing it down or being clipped
// by a scrolling panel. It stays in the React tree of the field, so the
// Share popover around it counts a press inside it as inside.

import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import Ico from './Icons';
import { Spinner } from './ui';
import { searchHubPeople } from '../api';
import { openExternal } from '../../platform/host';
import { MINDS_MEMBERS_URL } from '../../lib/mindsUrls';
import { isEmailShaped } from '../lib/emailAddress';
import {
  filterPeople,
  filterTeams,
  orgNameOrGeneric,
  personInitials,
  recipientSummary,
  shareableTeams,
} from '../lib/orgSharing';
import { useHubTeams, useKnownPeople, useOrgDirectory } from '../hooks/useOrgSharing';
import { RecipientRow, UNKNOWN_TEAM, recipientItems } from './RecipientRows';

export const RECIPIENT_SEARCH_DEBOUNCE_MS = 200;
const MIN_QUERY = 2;
const SEPARATORS = /[\s,;]+/;
// The dropdown's tallest, and the least room below the input before it opens
// above instead.
const MENU_MAX_HEIGHT = 320;
const MENU_MIN_BELOW = 200;
const MENU_GAP = 4;
export { UNKNOWN_TEAM };

const EMPTY_VALUE = Object.freeze({ teamIds: [], userIds: [], emails: [] });
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

const TILE = 'inline-grid shrink-0 place-items-center w-[28px] h-[28px] rounded-full';

function TeamTile() {
  return <span aria-hidden="true" className={`${TILE} border border-solid border-line bg-surface-2 text-ink-3`}>{Ico.people(14)}</span>;
}

function PersonTile({ person }) {
  return (
    <span aria-hidden="true" className={`${TILE} bg-accent-bg text-accent font-body text-[11px] font-semibold`}>
      {person && (person.name || person.email) ? personInitials(person) : '?'}
    </span>
  );
}

function MailTile() {
  return <span aria-hidden="true" className={`${TILE} border border-solid border-warning-border bg-warning-bg text-warning-text`}>{Ico.mail(14)}</span>;
}

/* A grey placeholder row while the directory loads. */
function SkeletonRow({ width }) {
  return (
    <li role="presentation" aria-hidden="true" data-testid="recipient-skeleton" className="flex items-center gap-2.5 py-[7px] px-2">
      <span className={`${TILE} bg-surface-2 animate-pulse`} />
      <span className="flex min-w-0 flex-1 flex-col gap-1.5">
        <span className="h-[9px] rounded-full bg-surface-2 animate-pulse" style={{ width }} />
        <span className="h-[8px] rounded-full bg-surface-2 animate-pulse" style={{ width: `calc(${width} * 1.4)` }} />
      </span>
    </li>
  );
}

/** Where the dropdown goes: under the input, or above when there's no room. */
function useMenuPosition(anchorRef, open) {
  const [position, setPosition] = useState(null);
  useLayoutEffect(() => {
    if (!open) { setPosition(null); return undefined; }
    const place = () => {
      const anchor = anchorRef.current;
      if (!anchor) return;
      const rect = anchor.getBoundingClientRect();
      const viewport = window.innerHeight || document.documentElement.clientHeight || 0;
      const below = viewport - rect.bottom - MENU_GAP - 12;
      const above = rect.top - MENU_GAP - 12;
      const flip = below < MENU_MIN_BELOW && above > below;
      setPosition({
        left: rect.left,
        width: rect.width,
        ...(flip ? { bottom: viewport - rect.top + MENU_GAP } : { top: rect.bottom + MENU_GAP }),
        maxHeight: Math.max(160, Math.min(MENU_MAX_HEIGHT, flip ? above : below)),
      });
    };
    place();
    window.addEventListener('resize', place);
    // Capture: any scrolling ancestor (a popover's body, a modal) moves the input.
    window.addEventListener('scroll', place, true);
    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(place) : null;
    if (observer && anchorRef.current) observer.observe(anchorRef.current);
    return () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
      observer?.disconnect();
    };
  }, [open, anchorRef]);
  return position;
}

/**
 * @param {{
 *   value: { teamIds?: string[], userIds?: string[], emails?: string[] },
 *   onChange: (next: { teamIds: string[], userIds: string[], emails: string[] }) => void,
 *   allowExternal?: boolean,
 *   emailsOnly?: boolean,
 *   orgName?: string | null,
 *   teamsState?: { status: string, reachable: boolean, teams: Array<{ id: string, display_name: string, is_default?: boolean, member_count?: number | null }> } | null,
 *   label?: string,
 *   autoFocus?: boolean,
 * }} props
 */
export function RecipientField({
  value,
  onChange,
  allowExternal = false,
  emailsOnly = false,
  orgName = null,
  teamsState: teamsProp = null,
  label,
  autoFocus = false,
}) {
  const teamIds = value?.teamIds || EMPTY_VALUE.teamIds;
  const userIds = value?.userIds || EMPTY_VALUE.userIds;
  const emails = value?.emails || EMPTY_VALUE.emails;
  // Several additions can land from one paste, some after a lookup, so each
  // builds on the last rather than on this render's value.
  const latest = useRef({ teamIds, userIds, emails });
  latest.current = { teamIds, userIds, emails };
  const emit = (patch) => {
    latest.current = { ...latest.current, ...patch };
    onChange(latest.current);
  };

  const ownTeams = useHubTeams(!emailsOnly && !teamsProp);
  const teamsState = teamsProp || ownTeams;
  const directory = useOrgDirectory(!emailsOnly);
  const known = useKnownPeople(emailsOnly ? EMPTY_VALUE.userIds : userIds);
  const org = orgNameOrGeneric(orgName);

  const anchorRef = useRef(null);
  const inputRef = useRef(null);
  const menuRef = useRef(null);
  const [text, setText] = useState('');
  const [open, setOpen] = useState(false);
  const [focused, setFocused] = useState(false);
  const [active, setActive] = useState(-1);
  // The hub search a truncated (or unreadable) directory falls back on:
  // 'idle' | 'searching' | 'ready' | 'unreachable'.
  const [status, setStatus] = useState('idle');
  const [results, setResults] = useState([]);
  const [notAdded, setNotAdded] = useState([]);
  const [resolving, setResolving] = useState(0);
  const listId = useId();
  const optionId = (i) => `${listId}-opt-${i}`;
  const query = text.trim();
  const directoryReady = directory.status === 'ready';
  // The directory holds everyone: nothing to ask the hub.
  const directoryComplete = directoryReady && !directory.truncated;
  const searches = !emailsOnly && !directoryComplete && directory.status !== 'loading' && directory.status !== 'idle'
    && query.length >= MIN_QUERY && !SEPARATORS.test(query);

  useEffect(() => {
    if (!searches) {
      setStatus('idle');
      setResults([]);
      return undefined;
    }
    setStatus('searching');
    const controller = new AbortController();
    const timer = setTimeout(() => {
      searchHubPeople(query, { signal: controller.signal }).then((result) => {
        if (controller.signal.aborted) return;
        setResults(result.people || []);
        setStatus(result.reachable ? 'ready' : 'unreachable');
      });
    }, RECIPIENT_SEARCH_DEBOUNCE_MS);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [query, searches]);

  // ── What the menu offers ──
  const typedEmail = query.toLowerCase();
  const typedIsEmail = isEmailShaped(typedEmail);
  const directoryPeople = directoryReady ? directory.people : EMPTY_VALUE.userIds;
  const findByEmail = (email) => directoryPeople.find((p) => (p.email || '') === email)
    || results.find((p) => (p.email || '').toLowerCase() === email)
    || null;
  const matchedPerson = typedIsEmail ? findByEmail(typedEmail) : null;
  // Whether "nobody in the org has this address" is known yet.
  const emailAnswered = directoryComplete || status === 'ready';
  const teamsReady = teamsState.status === 'ready' && teamsState.reachable;
  const ownShareable = teamsReady ? shareableTeams(teamsState.teams) : [];
  const teamOptions = emailsOnly ? [] : filterTeams(ownShareable, query).filter((t) => !teamIds.includes(t.id));
  let peopleOptions = [];
  if (!emailsOnly) {
    const seen = new Set(userIds);
    // Pasted lists aren't filtered: they are added on their own.
    const local = SEPARATORS.test(query) ? [] : filterPeople(directoryPeople, query);
    for (const person of [...local, ...(searches ? results : [])]) {
      if (seen.has(person.id)) continue;
      seen.add(person.id);
      peopleOptions.push(person);
    }
  }
  const canInvite = typedIsEmail && !emails.includes(typedEmail) && (emailsOnly
    || (allowExternal && emailAnswered && !matchedPerson));
  const options = [
    ...teamOptions.map((team) => ({ kind: 'team', key: `team:${team.id}`, team })),
    ...peopleOptions.map((person) => ({ kind: 'person', key: `person:${person.id}`, person })),
    ...(canInvite ? [{ kind: 'invite', key: `invite:${typedEmail}`, email: typedEmail }] : []),
  ];
  const current = active >= 0 && active < options.length ? active : (query && options.length ? 0 : -1);

  // Rows under the lists: loading, a failure, nothing found.
  const directoryLoading = !emailsOnly && (directory.status === 'loading' || directory.status === 'idle');
  const teamsLoading = !emailsOnly && !teamsProp && teamsState.status !== 'ready';
  const searching = searches && status === 'searching';
  const nothingFound = !emailsOnly && !!query && options.length === 0 && !directoryLoading && !searching
    && directory.status !== 'error' && !(typedIsEmail && !allowExternal);
  const menuOpen = open && !emailsOnly ? true : open && options.length > 0;
  // A typed email nobody in the org has, where only the org may be named.
  const showOrgOnlyHint = !emailsOnly && !allowExternal && typedIsEmail && emailAnswered && !matchedPerson;
  const position = useMenuPosition(anchorRef, menuOpen);

  // Keep the highlighted row in view as the arrows move it.
  useEffect(() => {
    if (!menuOpen || current < 0) return;
    const el = menuRef.current?.querySelector(`[id="${optionId(current)}"]`);
    el?.scrollIntoView?.({ block: 'nearest' });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current, menuOpen]);

  // ── Adding and removing ──
  const resetInput = () => {
    setText('');
    setActive(-1);
    setNotAdded([]);
  };

  const add = (option, { close = false } = {}) => {
    if (!option) return;
    if (option.kind === 'team') {
      if (!latest.current.teamIds.includes(option.team.id)) emit({ teamIds: [...latest.current.teamIds, option.team.id] });
    } else if (option.kind === 'person') {
      known.remember([option.person]);
      if (!latest.current.userIds.includes(option.person.id)) emit({ userIds: [...latest.current.userIds, option.person.id] });
    } else if (option.kind === 'invite') {
      if (!latest.current.emails.includes(option.email)) emit({ emails: [...latest.current.emails, option.email] });
    }
    resetInput();
    // A click closes the menu so the recipient just added is in view (typing
    // or a click on the input opens it again). Enter keeps it open, so the
    // keyboard can add several in a row.
    if (close) setOpen(false);
  };

  // Each typed or pasted address becomes a person when the org has that
  // exact email, else an outside email when allowed, else it is reported.
  // The directory answers when it holds everyone; otherwise the hub is asked.
  const resolveTokens = async (tokens) => {
    resetInput();
    const lookups = tokens.map(async (raw) => {
      const email = raw.toLowerCase();
      if (!isEmailShaped(email)) return { raw, reason: 'not an email' };
      if (emailsOnly) return { email };
      const local = findByEmail(email);
      if (local) return { person: local };
      if (!directoryComplete) {
        const found = await searchHubPeople(email).catch(() => ({ reachable: false, people: [] }));
        const person = (found.people || []).find((p) => (p.email || '').toLowerCase() === email);
        if (person) return { person };
      }
      if (allowExternal) return { email };
      return { raw: email, reason: `not in ${org}` };
    });
    setResolving((n) => n + 1);
    let answers;
    try {
      answers = await Promise.all(lookups);
    } finally {
      setResolving((n) => n - 1);
    }
    const next = { ...latest.current, userIds: [...latest.current.userIds], emails: [...latest.current.emails] };
    const people = [];
    const refused = [];
    for (const answer of answers) {
      if (answer.person) {
        people.push(answer.person);
        if (!next.userIds.includes(answer.person.id)) next.userIds.push(answer.person.id);
      } else if (answer.email) {
        if (!next.emails.includes(answer.email)) next.emails.push(answer.email);
      } else {
        refused.push(answer);
      }
    }
    if (people.length) known.remember(people);
    if (next.userIds.length !== latest.current.userIds.length || next.emails.length !== latest.current.emails.length) {
      emit({ userIds: next.userIds, emails: next.emails });
    }
    setNotAdded(refused);
  };

  /** Adds what Enter / Tab / comma means right now; false when nothing. */
  const commit = () => {
    if (active >= 0 && options[active]) { add(options[active]); return true; }
    if (!query) return false;
    const tokens = query.split(SEPARATORS).filter(Boolean);
    if (tokens.length > 1) { resolveTokens(tokens); return true; }
    if (typedIsEmail) { commitEmail(); return true; }
    if (options[current]) { add(options[current]); return true; }
    return false;
  };

  /** The typed text is one address: add whoever it names. */
  const commitEmail = () => {
    const invite = options.find((o) => o.kind === 'invite');
    if (matchedPerson && !userIds.includes(matchedPerson.id)) add({ kind: 'person', person: matchedPerson });
    else if (invite) add(invite);
    else if (matchedPerson || emails.includes(typedEmail)) resetInput();
    else resolveTokens([query]);
  };

  const removeTeam = (id) => emit({ teamIds: latest.current.teamIds.filter((t) => t !== id) });
  const removeUser = (id) => emit({ userIds: latest.current.userIds.filter((u) => u !== id) });
  const removeEmail = (email) => emit({ emails: latest.current.emails.filter((e) => e !== email) });

  const onKeyDown = (e) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setOpen(true);
      if (options.length) setActive((i) => ((i < 0 ? current : i) + 1) % options.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setOpen(true);
      if (options.length) setActive((i) => { const from = i < 0 ? current : i; return from <= 0 ? options.length - 1 : from - 1; });
    } else if (e.key === 'Enter') {
      e.preventDefault();
      commit();
    } else if (e.key === 'Tab') {
      if (e.shiftKey) return;
      if ((query || active >= 0) && commit()) e.preventDefault();
    } else if (e.key === ',' || e.key === ';') {
      if (!query) return;
      e.preventDefault();
      commit();
    } else if (e.key === 'Escape') {
      if (menuOpen) { e.preventDefault(); e.stopPropagation(); }
      setOpen(false);
      setActive(-1);
    }
  };

  const onPaste = (e) => {
    const pasted = e.clipboardData?.getData('text') || '';
    const tokens = `${text} ${pasted}`.split(SEPARATORS).filter(Boolean);
    // One plain word or address pastes into the box like any text.
    if (tokens.length <= 1 || !tokens.some((t) => isEmailShaped(t))) return;
    e.preventDefault();
    resolveTokens(tokens);
  };

  // ── The list ──
  // Newest first: keys already shown keep their place, new ones go on top.
  const items = recipientItems({ teamIds, userIds, emails }, { teamsState, people: known.people, orgName, emailsOnly });
  const order = useRef(null);
  const quietFocus = useRef(false);
  const listRef = useRef(null);
  const keys = items.map((item) => item.key);
  if (order.current === null) {
    order.current = keys;
  } else {
    const present = new Set(keys);
    const kept = order.current.filter((k) => present.has(k));
    const keptSet = new Set(kept);
    order.current = [...keys.filter((k) => !keptSet.has(k)), ...kept];
  }
  const byKey = new Map(items.map((item) => [item.key, item]));
  const rows = order.current.map((k) => byKey.get(k));
  const newest = rows[0]?.key;
  // An addition shows at the top, so the list scrolls back there.
  useEffect(() => {
    if (listRef.current) listRef.current.scrollTop = 0;
  }, [newest]);
  const removeItem = (item) => {
    const id = item.key.slice(2);
    if (item.key.startsWith('t:')) removeTeam(id);
    else if (item.key.startsWith('u:')) removeUser(id);
    else removeEmail(id);
    // The row and its × go; the focus lands back on the input, quietly.
    quietFocus.current = true;
    inputRef.current?.focus();
    quietFocus.current = false;
  };

  const fieldLabel = label || (emailsOnly
    ? 'Add people by email'
    : (allowExternal ? 'Add teams, people or emails' : 'Add teams or people'));
  const placeholder = emailsOnly
    ? 'Add people by email…'
    : (allowExternal ? 'Add teams, people or emails…' : 'Add teams or people…');
  const summary = recipientSummary({ teamIds, userIds, emails }, { orgName, emailsOnly, allowExternal });

  // ── The dropdown ──
  const groupHeader = (key, title) => (
    <li key={key} role="presentation" className="px-2 pt-2 pb-1 font-body text-[11.5px] font-medium text-ink-4">{title}</li>
  );
  const optionRow = (option, i) => {
    const selected = i === current;
    const rowProps = {
      id: optionId(i),
      role: 'option',
      'aria-selected': selected,
      // mousedown, not click: the input's blur would close the list first.
      onMouseDown: (e) => { e.preventDefault(); add(option, { close: true }); },
      onMouseMove: () => { if (active !== i) setActive(i); },
      className: `flex min-w-0 cursor-pointer items-center gap-2.5 rounded-[8px] py-[6px] px-2 font-body ${selected ? 'bg-surface-2' : ''}`,
    };
    if (option.kind === 'team') {
      const count = option.team.member_count;
      return (
        <li key={option.key} {...rowProps}>
          <TeamTile />
          <span className="flex min-w-0 flex-1 flex-col">
            <span className="truncate text-[13px] font-medium leading-[18px] text-ink" title={option.team.display_name}>{option.team.display_name}</span>
            <span className="truncate text-[11.5px] leading-[16px] text-ink-3">{Number.isInteger(count) ? plural(count, 'person', 'people') : 'Team'}</span>
          </span>
        </li>
      );
    }
    if (option.kind === 'person') {
      const { name, email } = option.person;
      return (
        <li key={option.key} {...rowProps}>
          <PersonTile person={option.person} />
          <span className="flex min-w-0 flex-1 flex-col">
            <span className="truncate text-[13px] font-medium leading-[18px] text-ink" title={name || email}>{name || email}</span>
            {name && email && <span className="truncate text-[11.5px] leading-[16px] text-ink-3" title={email}>{email}</span>}
          </span>
        </li>
      );
    }
    return (
      <li key={option.key} {...rowProps}>
        <MailTile />
        <span className="min-w-0 flex-1 truncate text-[13px] text-ink" title={option.email}>
          {emailsOnly ? `Add ${option.email}` : `Invite ${option.email}`}
          {!emailsOnly && <span className="text-ink-3">{` (outside ${org})`}</span>}
        </span>
      </li>
    );
  };

  const listChildren = [];
  options.forEach((option, i) => {
    const prev = options[i - 1];
    if (!prev || prev.kind !== option.kind) {
      if (option.kind === 'team') listChildren.push(groupHeader('h-team', 'Teams'));
      if (option.kind === 'person') listChildren.push(groupHeader('h-person', `People in ${org}`));
    }
    listChildren.push(optionRow(option, i));
  });
  // Placeholders where a group is still on its way, under that group's title.
  const skeletons = (key, title, widths) => [
    groupHeader(`${key}-h`, title),
    ...widths.map((w, i) => <SkeletonRow key={`${key}-${i}`} width={w} />),
  ];
  if (teamsLoading && !query) listChildren.unshift(...skeletons('st', 'Teams', ['38%']));
  if (directoryLoading) listChildren.push(...skeletons('sp', `People in ${org}`, ['42%', '30%', '36%']));
  // The directory answered but offers nobody: say so under its title rather
  // than drop the group, which reads as "people aren't supported here".
  const peopleEmpty = !emailsOnly && !query && directoryReady && peopleOptions.length === 0;
  if (peopleEmpty) {
    listChildren.push(groupHeader('h-person-empty', `People in ${org}`));
    listChildren.push(
      <li key="person-empty" role="presentation" className="px-2 py-1.5 font-body text-xs text-ink-3">
        {directoryPeople.length === 0 ? (
          <>
            {`No one else is in ${org} yet. `}
            <button
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => { openExternal(MINDS_MEMBERS_URL); }}
              className="bg-transparent border-0 cursor-pointer p-0 font-body text-xs font-semibold text-accent"
            >Invite people ↗</button>
          </>
        ) : `Everyone in ${org} is already added.`}
      </li>,
    );
  }

  let footer = null;
  if (!emailsOnly && directory.status === 'error') {
    footer = (
      <div role="alert" className="flex items-center justify-between gap-3 py-2 px-2 font-body text-xs text-ink-3">
        <span className="min-w-0">Couldn&apos;t load your organization&apos;s directory</span>
        <button
          type="button"
          onMouseDown={(e) => e.preventDefault()}
          onClick={directory.retry}
          className="shrink-0 bg-transparent border-0 cursor-pointer p-0 font-body text-xs font-semibold text-accent"
        >Retry</button>
      </div>
    );
  }
  const teamsUnreachable = !emailsOnly && teamsState.status === 'ready' && !teamsState.reachable;
  const statusLine = searching
    ? <span className="inline-flex items-center gap-2"><Spinner /> Searching everyone in {org}…</span>
    : showOrgOnlyHint ? `Only people in ${org}`
    : nothingFound ? 'No matches'
      : (!query && !peopleEmpty && !directoryLoading && !teamsLoading && options.length === 0 && directory.status !== 'error' && !teamsUnreachable)
        ? 'Everyone you can add is already added.'
        : null;
  const truncatedNote = !emailsOnly && directoryReady && directory.truncated
    ? `Showing the first ${directory.people.length} people. Type to search everyone.`
    : null;

  const menu = menuOpen && (
    <div
      ref={menuRef}
      data-testid="recipient-menu"
      // A press anywhere in the menu (its scrollbar too) keeps the input focused.
      onMouseDown={(e) => e.preventDefault()}
      className="flex flex-col overflow-hidden rounded-[10px] border border-solid border-line bg-surface font-body shadow-sh-popup"
      style={{
        position: 'fixed',
        zIndex: 1000,
        left: position?.left ?? 0,
        top: position?.top,
        bottom: position?.bottom,
        width: position?.width || undefined,
        maxHeight: position?.maxHeight ?? MENU_MAX_HEIGHT,
        visibility: position ? 'visible' : 'hidden',
      }}
    >
      <div className="min-h-0 flex-1 overflow-y-auto p-1">
        {listChildren.length > 0 && (
          <ul id={listId} role="listbox" aria-label="Suggestions" className="m-0 flex list-none flex-col p-0">
            {listChildren}
          </ul>
        )}
        {teamsUnreachable && !query && (
          <div role="status" className="py-2 px-2 font-body text-xs text-ink-3">Couldn&apos;t load your teams. Try again later.</div>
        )}
        {statusLine && (
          <div role="status" className="py-2 px-2 font-body text-xs text-ink-3">{statusLine}</div>
        )}
        {footer}
      </div>
      {truncatedNote && (
        <div className="shrink-0 border-t border-b-0 border-x-0 border-solid border-line py-2 px-3 font-body text-[11.5px] text-ink-3" role="note">
          {truncatedNote}
        </div>
      )}
    </div>
  );

  return (
    <div className="flex min-w-0 flex-col">
      <div
        ref={anchorRef}
        className="flex h-[34px] min-w-0 items-center gap-2 rounded-card-row border border-solid bg-surface pl-[10px] pr-2"
        style={{
          borderColor: focused ? 'var(--accent)' : 'var(--line)',
          transition: 'border-color var(--dur-hover) ease',
        }}
      >
        <span aria-hidden="true" className="inline-flex shrink-0 text-ink-4">{Ico.search(14)}</span>
        <input
          ref={inputRef}
          role="combobox"
          aria-label={fieldLabel}
          aria-autocomplete="list"
          aria-expanded={menuOpen && options.length > 0}
          aria-controls={listId}
          aria-activedescendant={menuOpen && current >= 0 && options[current] ? optionId(current) : undefined}
          autoComplete="off"
          autoFocus={autoFocus}
          value={text}
          placeholder={placeholder}
          onChange={(e) => {
            setText(e.target.value);
            setOpen(true);
            setActive(-1);
            if (notAdded.length) setNotAdded([]);
          }}
          onKeyDown={onKeyDown}
          onPaste={onPaste}
          onFocus={() => { setFocused(true); if (!emailsOnly && !quietFocus.current) setOpen(true); }}
          onClick={() => setOpen(true)}
          onBlur={() => {
            setFocused(false);
            setOpen(false);
            setActive(-1);
            // An address typed and left is added rather than lingering.
            if (typedIsEmail && (emailsOnly || allowExternal)) commitEmail();
          }}
          className="min-w-0 flex-1 bg-transparent border-0 [outline:none] p-0 font-body text-[13px] text-ink"
        />
        {resolving > 0 && <Spinner />}
      </div>

      {menu && typeof document !== 'undefined' ? createPortal(menu, document.body) : null}

      {notAdded.length > 0 && (
        <span className="mt-[6px] font-body text-xs text-danger" role="alert">
          {`Not added: ${notAdded.map((n) => `${n.raw} (${n.reason})`).join(', ')}`}
        </span>
      )}
      {rows.length > 0 && (
        <ul
          ref={listRef}
          aria-label="Recipients"
          className="m-0 mt-2 flex min-w-0 max-h-[206px] list-none flex-col overflow-y-auto rounded-card-row border border-solid border-line bg-surface py-[2px] px-0"
        >
          {rows.map((item) => <RecipientRow key={item.key} item={item} onRemove={() => removeItem(item)} />)}
        </ul>
      )}
      <span className="mt-[6px] font-body text-xs text-ink-3" data-testid="recipient-summary" aria-live="polite">{summary}</span>
    </div>
  );
}

export default RecipientField;
