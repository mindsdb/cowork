// `<RecipientField>` — who to share with, typed the way an email client's
// "To:" line is (ENG-3787). One bordered box holds the picked recipients as
// pills and a text input that wraps after them; the trailing + opens the
// suggestions.
//
// Recipients come in three kinds, kept apart in `value`:
//   - teams (`teamIds`) — the caller's own MindsHub teams, the org's default
//     team left out ("Everyone at ‹org›" is that choice);
//   - people in the org (`userIds`) — found by name or email in the org's
//     directory (`searchHubPeople`), named afterwards by `useKnownPeople`;
//   - outside emails (`emails`) — only with `allowExternal`.
// With `emailsOnly` (no org to search) it is just addresses.
//
// Focusing, clicking or + with nothing typed lists the teams. Typing filters
// them and, after a short pause, searches people (a newer keystroke aborts the
// older request). A typed email nobody in the org has becomes the last row,
// "Invite …", when outside emails are allowed. ↑/↓ move, Enter / Tab / comma
// add the highlighted (or top) row, Escape closes, Backspace in an empty input
// removes the last pill. A paste of several addresses adds each: a person
// when the org has that exact email, else an outside email when allowed, else
// it is reported as not added.

import { useEffect, useId, useRef, useState } from 'react';
import Ico from './Icons';
import { Spinner, Tooltip } from './ui';
import { searchHubPeople } from '../api';
import { isEmailShaped } from '../lib/emailAddress';
import {
  UNKNOWN_PERSON,
  filterTeams,
  orgNameOrGeneric,
  personInitials,
  recipientSummary,
  shareableTeams,
} from '../lib/orgSharing';
import { useHubTeams, useKnownPeople } from '../hooks/useOrgSharing';

export const RECIPIENT_SEARCH_DEBOUNCE_MS = 200;
const MIN_QUERY = 2;
const SEPARATORS = /[\s,;]+/;
export const UNKNOWN_TEAM = 'Unknown team';

const EMPTY_VALUE = Object.freeze({ teamIds: [], userIds: [], emails: [] });

function PillShell({ tone = 'default', children, onRemove, removeLabel }) {
  const toneClass = tone === 'outside'
    ? 'bg-warning-bg border-warning-border text-warning-text'
    : 'bg-surface-2 border-line text-ink';
  return (
    <span
      data-recipient-pill=""
      className={`inline-flex min-w-0 max-w-full items-center gap-[5px] rounded-full border border-solid py-[1px] pl-[3px] pr-[2px] font-body text-[12px] leading-[20px] ${toneClass}`}
    >
      {children}
      <button
        type="button"
        aria-label={removeLabel}
        onClick={(e) => { e.stopPropagation(); onRemove(); }}
        // Keeps the focus where it was when the pill goes.
        onMouseDown={(e) => e.preventDefault()}
        className="inline-flex shrink-0 rounded-full bg-transparent border-0 cursor-pointer p-[2px] text-current opacity-60 hover:opacity-100"
      >{Ico.close(12)}</button>
    </span>
  );
}

function PillLabel({ text, tip }) {
  return (
    <Tooltip content={tip || text}>
      <span className="min-w-0 truncate">{text}</span>
    </Tooltip>
  );
}

function IconTile({ children }) {
  return (
    <span className="inline-grid shrink-0 place-items-center w-[18px] h-[18px] rounded-full bg-surface text-ink-3">{children}</span>
  );
}

function Avatar({ person, size = 18 }) {
  return (
    <span
      aria-hidden="true"
      className="inline-grid shrink-0 place-items-center rounded-full bg-accent-bg text-accent font-body font-semibold"
      style={{ width: size, height: size, fontSize: size <= 18 ? 9.5 : 11 }}
    >{person && (person.name || person.email) ? personInitials(person) : '?'}</span>
  );
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
  const known = useKnownPeople(emailsOnly ? EMPTY_VALUE.userIds : userIds);
  const org = orgNameOrGeneric(orgName);

  const inputRef = useRef(null);
  const [text, setText] = useState('');
  const [open, setOpen] = useState(false);
  const [focused, setFocused] = useState(false);
  const [active, setActive] = useState(-1);
  // 'idle' | 'searching' | 'ready' | 'unreachable'
  const [status, setStatus] = useState('idle');
  const [results, setResults] = useState([]);
  const [notAdded, setNotAdded] = useState([]);
  const [resolving, setResolving] = useState(0);
  const listId = useId();
  const optionId = (i) => `${listId}-opt-${i}`;
  const query = text.trim();
  const searches = !emailsOnly && query.length >= MIN_QUERY && !SEPARATORS.test(query);

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
  const matchedPerson = results.find((p) => (p.email || '').toLowerCase() === typedEmail) || null;
  const teamsReady = teamsState.status === 'ready' && teamsState.reachable;
  const ownShareable = teamsReady ? shareableTeams(teamsState.teams) : [];
  const teamOptions = emailsOnly ? [] : filterTeams(ownShareable, query).filter((t) => !teamIds.includes(t.id));
  const peopleOptions = searches && (status === 'ready' || status === 'unreachable')
    ? results.filter((p) => !userIds.includes(p.id))
    : [];
  const canInvite = typedIsEmail && !emails.includes(typedEmail) && (emailsOnly
    || (allowExternal && status === 'ready' && !matchedPerson));
  const options = [
    ...teamOptions.map((team) => ({ kind: 'team', key: `team:${team.id}`, team })),
    ...peopleOptions.map((person) => ({ kind: 'person', key: `person:${person.id}`, person })),
    ...(canInvite ? [{ kind: 'invite', key: `invite:${typedEmail}`, email: typedEmail }] : []),
  ];
  const current = active >= 0 && active < options.length ? active : (query && options.length ? 0 : -1);

  let statusLine = null;
  if (!emailsOnly) {
    if (!query) {
      if (teamsState.status !== 'ready') statusLine = <span className="inline-flex items-center gap-2"><Spinner /> Loading teams…</span>;
      else if (!teamsState.reachable) statusLine = "Couldn't load your teams. Try again later.";
      else if (ownShareable.length === 0) statusLine = "You're not in any teams yet. Type a name to find people.";
      else if (teamOptions.length === 0) statusLine = 'All your teams are added. Type a name to find people.';
    } else if (searches && status === 'searching') {
      statusLine = <span className="inline-flex items-center gap-2"><Spinner /> Searching…</span>;
    } else if (searches && status === 'unreachable') {
      statusLine = `Couldn't search people in ${org}.`;
    } else if (searches && status === 'ready' && options.length === 0) {
      statusLine = 'No matches';
    }
  }
  const menuOpen = open && (options.length > 0 || statusLine != null);
  // A typed email nobody in the org has, where only the org may be named.
  const showOrgOnlyHint = !emailsOnly && !allowExternal && typedIsEmail && status === 'ready' && !matchedPerson;

  // ── Adding and removing ──
  const resetInput = () => {
    setText('');
    setActive(-1);
    setNotAdded([]);
  };

  const add = (option) => {
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
  };

  // Each typed or pasted address becomes a person when the org has that
  // exact email, else an outside email when allowed, else it is reported.
  const resolveTokens = async (tokens) => {
    resetInput();
    const lookups = tokens.map(async (raw) => {
      const email = raw.toLowerCase();
      if (!isEmailShaped(email)) return { raw, reason: 'not an email' };
      if (emailsOnly) return { email };
      const local = results.find((p) => (p.email || '').toLowerCase() === email);
      if (local) return { person: local };
      const found = await searchHubPeople(email).catch(() => ({ reachable: false, people: [] }));
      const person = (found.people || []).find((p) => (p.email || '').toLowerCase() === email);
      if (person) return { person };
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
  const removeLast = () => {
    if (emails.length) removeEmail(emails[emails.length - 1]);
    else if (userIds.length) removeUser(userIds[userIds.length - 1]);
    else if (teamIds.length) removeTeam(teamIds[teamIds.length - 1]);
  };

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
    } else if (e.key === 'Backspace' && text === '') {
      if (teamIds.length || userIds.length || emails.length) { e.preventDefault(); removeLast(); }
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

  const focusInput = () => inputRef.current?.focus();
  const onPlus = () => {
    if (emailsOnly && query) { commit(); focusInput(); return; }
    focusInput();
    setOpen(true);
  };

  // ── Pills ──
  const teamName = (id) => {
    const team = (teamsState.teams || []).find((t) => t.id === id);
    if (team) return team.display_name;
    return teamsState.status === 'ready' ? UNKNOWN_TEAM : 'Loading…';
  };
  const peopleById = new Map(known.people.map((p) => [p.id, p]));
  const outsideTip = `Outside ${org}`;

  const pills = [
    ...teamIds.map((id) => {
      const name = teamName(id);
      return (
        <PillShell key={`t:${id}`} removeLabel={`Remove ${name}`} onRemove={() => removeTeam(id)}>
          <IconTile>{Ico.people(12)}</IconTile>
          <PillLabel text={name} />
        </PillShell>
      );
    }),
    ...userIds.map((id) => {
      const person = peopleById.get(id);
      const name = person?.pending ? 'Loading…' : (person?.name || person?.email || UNKNOWN_PERSON);
      return (
        <PillShell key={`u:${id}`} removeLabel={`Remove ${person?.email || name}`} onRemove={() => removeUser(id)}>
          <Avatar person={person} />
          <PillLabel text={name} tip={person?.email || name} />
        </PillShell>
      );
    }),
    ...emails.map((email) => (
      <PillShell key={`e:${email}`} tone={emailsOnly ? 'default' : 'outside'} removeLabel={`Remove ${email}`} onRemove={() => removeEmail(email)}>
        <IconTile>{Ico.mail(12)}</IconTile>
        <PillLabel text={email} tip={emailsOnly ? email : `${email} · ${outsideTip}`} />
      </PillShell>
    )),
  ];

  const fieldLabel = label || (emailsOnly
    ? 'Add people by email'
    : (allowExternal ? 'Add teams, people or emails' : 'Add teams or people'));
  const placeholder = pills.length ? '' : (emailsOnly
    ? 'name@company.com'
    : (allowExternal ? 'Teams, people or emails' : 'Teams or people'));
  const summary = recipientSummary({ teamIds, userIds, emails }, { orgName, emailsOnly, allowExternal });

  const groupHeader = (text) => (
    <li role="presentation" className="px-2 pt-[6px] pb-[2px] font-body text-[11px] font-semibold uppercase tracking-[0.04em] text-ink-4">{text}</li>
  );

  return (
    <div className="flex min-w-0 flex-col">
      <div
        role="group"
        aria-label="Recipients"
        onClick={(e) => { if (e.target === e.currentTarget) { focusInput(); setOpen(true); } }}
        className="flex min-h-[36px] min-w-0 cursor-text flex-wrap items-center gap-[5px] rounded-card-row border border-solid bg-surface py-[5px] pl-[6px] pr-[5px]"
        style={{
          borderColor: focused ? 'var(--accent)' : 'var(--line)',
          transition: 'border-color var(--dur-hover) ease',
        }}
      >
        {pills}
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
          onFocus={() => { setFocused(true); if (!emailsOnly) setOpen(true); }}
          onClick={() => setOpen(true)}
          onBlur={() => {
            setFocused(false);
            setOpen(false);
            setActive(-1);
            // An address typed and left becomes a pill rather than lingering.
            if (typedIsEmail && (emailsOnly || allowExternal)) commitEmail();
          }}
          className="min-w-[80px] flex-1 bg-transparent border-0 [outline:none] py-[3px] px-1 font-body text-[13px] text-ink"
        />
        {resolving > 0 && <Spinner />}
        <Tooltip content={emailsOnly ? 'Add' : 'Show suggestions'}>
          <button
            type="button"
            aria-label={emailsOnly ? 'Add' : 'Show suggestions'}
            onMouseDown={(e) => e.preventDefault()}
            onClick={onPlus}
            className="ml-auto inline-grid shrink-0 place-items-center w-[24px] h-[24px] rounded-[6px] bg-transparent border-0 cursor-pointer text-ink-3 hover:bg-surface-2"
          >{Ico.plus(14)}</button>
        </Tooltip>
      </div>

      {menuOpen && (
        <div className="mt-1 min-w-0 rounded-card border border-solid border-line bg-surface p-1 shadow-sm">
          {options.length > 0 && (
            <ul id={listId} role="listbox" aria-label="Suggestions" className="m-0 p-0 list-none flex max-h-[220px] flex-col overflow-y-auto">
              {options.map((option, i) => {
                const prev = options[i - 1];
                const header = !prev || prev.kind !== option.kind
                  ? (option.kind === 'team' ? 'Teams' : option.kind === 'person' ? `People in ${org}` : null)
                  : null;
                const selected = i === current;
                const rowClass = `flex min-w-0 cursor-pointer items-center gap-2 rounded-card-row py-[6px] px-2 font-body text-[13px] ${selected ? 'bg-surface-2' : ''}`;
                const rowProps = {
                  id: optionId(i),
                  role: 'option',
                  'aria-selected': selected,
                  // mousedown, not click: the input's blur would close the list first.
                  onMouseDown: (e) => { e.preventDefault(); add(option); },
                  onMouseEnter: () => setActive(i),
                  className: rowClass,
                };
                let row;
                if (option.kind === 'team') {
                  const count = option.team.member_count;
                  row = (
                    <li {...rowProps}>
                      <IconTile>{Ico.people(12)}</IconTile>
                      <span className="min-w-0 flex-1 truncate text-ink" title={option.team.display_name}>{option.team.display_name}</span>
                      {Number.isInteger(count) && (
                        <span className="shrink-0 text-[11.5px] text-ink-4">{count === 1 ? '1 member' : `${count} members`}</span>
                      )}
                    </li>
                  );
                } else if (option.kind === 'person') {
                  row = (
                    <li {...rowProps}>
                      <Avatar person={option.person} size={22} />
                      <span className="flex min-w-0 flex-1 flex-col">
                        {option.person.name && <span className="truncate font-semibold text-ink" title={option.person.name}>{option.person.name}</span>}
                        <span className={`truncate ${option.person.name ? 'text-[11.5px] text-ink-3' : 'text-ink'}`} title={option.person.email}>{option.person.email}</span>
                      </span>
                    </li>
                  );
                } else {
                  row = (
                    <li {...rowProps}>
                      <IconTile>{Ico.mail(12)}</IconTile>
                      <span className="min-w-0 flex-1 truncate text-ink" title={option.email}>
                        {emailsOnly ? `Add ${option.email}` : `Invite ${option.email}`}
                        {!emailsOnly && <span className="text-ink-3">{` (outside ${org})`}</span>}
                      </span>
                    </li>
                  );
                }
                return (
                  <FragmentRow key={option.key} header={header && groupHeader(header)}>{row}</FragmentRow>
                );
              })}
            </ul>
          )}
          {statusLine && (
            <div role="status" className="py-[6px] px-2 font-body text-xs text-ink-3">{statusLine}</div>
          )}
        </div>
      )}

      {showOrgOnlyHint && (
        <span className="mt-[6px] font-body text-xs text-ink-3" role="note">{`Only people in ${org}`}</span>
      )}
      {notAdded.length > 0 && (
        <span className="mt-[6px] font-body text-xs text-danger" role="alert">
          {`Not added: ${notAdded.map((n) => `${n.raw} (${n.reason})`).join(', ')}`}
        </span>
      )}
      <span className="mt-[6px] font-body text-xs text-ink-3" data-testid="recipient-summary" aria-live="polite">{summary}</span>
    </div>
  );
}

function FragmentRow({ header, children }) {
  return (
    <>
      {header}
      {children}
    </>
  );
}

export default RecipientField;
