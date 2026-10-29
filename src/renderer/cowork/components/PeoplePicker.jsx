// `<PeoplePicker>` — find people in the caller's MindsHub org by name or
// email and add them as chips (ENG-3787). Typing two or more characters
// searches `/hub/people/` after a short pause; a newer keystroke aborts the
// older request. Arrow keys move through the suggestions, Enter adds one,
// Escape closes the list.
//
// Controlled: `value` is the picked emails (lowercased) and `onChange` gets
// the next list. With `allowExternal`, a full email nobody in the org matches
// can be added too ("Add x@y.com (outside ‹org›)"); without it only people
// the search found can be added.

import { useEffect, useId, useRef, useState } from 'react';
import { Input, Spinner } from './ui';
import { EmailChip } from './EmailChipsInput';
import { searchHubPeople } from '../api';
import { isEmailShaped } from '../lib/emailAddress';
import { orgNameOrGeneric } from '../lib/orgSharing';

export const PEOPLE_SEARCH_DEBOUNCE_MS = 200;
const MIN_QUERY = 2;

function chipLabel(email, name) {
  return name ? `${name} (${email})` : email;
}

/**
 * @param {{
 *   value: string[],
 *   onChange: (emails: string[]) => void,
 *   allowExternal?: boolean,
 *   orgName?: string | null,
 *   inputLabel?: string,
 * }} props
 */
export function PeoplePicker({ value, onChange, allowExternal = false, orgName = null, inputLabel = 'Search people' }) {
  const emails = value || [];
  const [text, setText] = useState('');
  // 'idle' | 'searching' | 'ready' | 'unreachable'
  const [status, setStatus] = useState('idle');
  const [results, setResults] = useState([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [blockedHint, setBlockedHint] = useState(false);
  // Names of the people picked here, so a chip can say who an address is.
  const [names, setNames] = useState(() => new Map());
  const listId = useId();
  const optionId = (i) => `${listId}-opt-${i}`;
  const query = text.trim();

  useEffect(() => {
    if (query.length < MIN_QUERY) {
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
        setActive(-1);
      });
    }, PEOPLE_SEARCH_DEBOUNCE_MS);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [query]);

  const picked = new Set(emails.map((e) => e.toLowerCase()));
  const people = status === 'ready' || status === 'unreachable'
    ? results.filter((p) => !picked.has(p.email))
    : [];
  const typedEmail = query.toLowerCase();
  const typedIsEmail = isEmailShaped(typedEmail);
  const typedMatched = results.some((p) => p.email === typedEmail);
  const offerExternal = allowExternal && typedIsEmail && !typedMatched && !picked.has(typedEmail)
    && status !== 'searching';
  const options = [
    ...people.map((p) => ({ kind: 'person', email: p.email, name: p.name })),
    ...(offerExternal ? [{ kind: 'external', email: typedEmail, name: null }] : []),
  ];
  const showList = open && query.length >= MIN_QUERY;

  const add = (option) => {
    if (!option || picked.has(option.email)) return;
    if (option.name) setNames((m) => new Map(m).set(option.email, option.name));
    onChange([...emails, option.email]);
    setText('');
    setActive(-1);
    setBlockedHint(false);
  };

  const onKeyDown = (e) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setOpen(true);
      if (options.length) setActive((i) => (i + 1) % options.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setOpen(true);
      if (options.length) setActive((i) => (i <= 0 ? options.length - 1 : i - 1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (active >= 0 && options[active]) { add(options[active]); return; }
      if (offerExternal) { add(options[options.length - 1]); return; }
      const exact = people.find((p) => p.email === typedEmail);
      if (exact) { add({ kind: 'person', ...exact }); return; }
      if (!allowExternal && typedIsEmail) setBlockedHint(true);
    } else if (e.key === 'Escape') {
      if (showList) { e.preventDefault(); e.stopPropagation(); }
      setOpen(false);
      setActive(-1);
    }
  };

  const orgLabel = orgNameOrGeneric(orgName);
  // Without allowExternal, a typed email that matches nobody can't be added.
  const showBlockedHint = !allowExternal && (blockedHint
    || (typedIsEmail && status === 'ready' && !typedMatched));

  let statusLine = null;
  if (showList) {
    if (status === 'searching') {
      statusLine = <span className="inline-flex items-center gap-2"><Spinner /> Searching…</span>;
    } else if (status === 'unreachable') {
      statusLine = allowExternal
        ? `Couldn't search ${orgLabel}. You can still add an email.`
        : "Couldn't load people from your organization.";
    } else if (status === 'ready' && options.length === 0) {
      statusLine = 'No matches';
    }
  }

  return (
    <div className="flex flex-col gap-2">
      {emails.length > 0 && (
        <ul className="m-0 p-0 list-none flex flex-wrap gap-[6px]" aria-label="Picked people">
          {emails.map((email) => (
            <EmailChip
              key={email}
              label={chipLabel(email, names.get(email))}
              removeLabel={`Remove ${email}`}
              onRemove={() => onChange(emails.filter((e) => e !== email))}
            />
          ))}
        </ul>
      )}
      <div className="relative">
        <Input
          role="combobox"
          aria-label={inputLabel}
          aria-autocomplete="list"
          aria-expanded={showList && options.length > 0}
          aria-controls={listId}
          aria-activedescendant={showList && active >= 0 && options[active] ? optionId(active) : undefined}
          autoComplete="off"
          value={text}
          placeholder="Name or email"
          onChange={(v) => {
            setText(v);
            setOpen(true);
            setActive(-1);
            setBlockedHint(false);
          }}
          onKeyDown={onKeyDown}
          onFocus={() => setOpen(true)}
          onBlur={() => setOpen(false)}
        />
        {showList && options.length > 0 && (
          <ul
            id={listId}
            role="listbox"
            aria-label="People suggestions"
            className="m-0 mt-1 p-1 list-none flex flex-col max-h-[200px] overflow-y-auto rounded-card border border-solid border-line bg-surface shadow-sm"
          >
            {options.map((option, i) => (
              <li
                key={`${option.kind}:${option.email}`}
                id={optionId(i)}
                role="option"
                aria-selected={i === active}
                // mousedown, not click: the input's blur would close the list first.
                onMouseDown={(e) => { e.preventDefault(); add(option); }}
                onMouseEnter={() => setActive(i)}
                className={`flex flex-col cursor-pointer rounded-card-row py-[6px] px-2 font-body text-[13px] ${i === active ? 'bg-surface-2' : ''}`}
              >
                {option.kind === 'external' ? (
                  <span className="text-ink">Add {option.email} (outside {orgLabel})</span>
                ) : (
                  <>
                    {option.name && <span className="font-semibold text-ink">{option.name}</span>}
                    <span className={option.name ? 'text-[11.5px] text-ink-3' : 'text-ink'}>{option.email}</span>
                  </>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
      {statusLine && <span className="font-body text-xs text-ink-3" role="status">{statusLine}</span>}
      {showBlockedHint && (
        <span className="font-body text-xs text-ink-3" role="note">Pick someone from your organization</span>
      )}
    </div>
  );
}

export default PeoplePicker;
