// `<PeoplePicker>` — find people in the caller's MindsHub org by name or
// email and add them as chips (ENG-3787). Typing two or more characters
// searches `/hub/people/` after a short pause; a newer keystroke aborts the
// older request. Arrow keys move through the suggestions, Enter adds one,
// Escape closes the list.
//
// Controlled: `value` is the picked people, `{ id, name, email }`, and
// `onChange` gets the next list. The id is what sharing stores
// (`allowed_user_ids`); the name and email only label the chip. A person
// whose name is still being looked up carries `pending: true`, and one the
// hub doesn't know shows as "Unknown person" and can still be removed.
// Only people the search found can be added: people outside the org go in
// the artifact panel's email box instead.

import { useEffect, useId, useState } from 'react';
import { Input, Spinner } from './ui';
import { EmailChip } from './EmailChipsInput';
import { searchHubPeople } from '../api';
import { isEmailShaped } from '../lib/emailAddress';
import { personLabel } from '../lib/orgSharing';

export const PEOPLE_SEARCH_DEBOUNCE_MS = 200;
const MIN_QUERY = 2;

/**
 * @param {{
 *   value: Array<{ id: string, name?: string | null, email?: string | null, pending?: boolean }>,
 *   onChange: (people: Array<{ id: string, name: string | null, email: string | null }>) => void,
 *   inputLabel?: string,
 * }} props
 */
export function PeoplePicker({ value, onChange, inputLabel = 'Search people' }) {
  const picked = value || [];
  const [text, setText] = useState('');
  // 'idle' | 'searching' | 'ready' | 'unreachable'
  const [status, setStatus] = useState('idle');
  const [results, setResults] = useState([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [blockedHint, setBlockedHint] = useState(false);
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

  const pickedIds = new Set(picked.map((p) => p.id));
  const options = status === 'ready' || status === 'unreachable'
    ? results.filter((p) => !pickedIds.has(p.id))
    : [];
  const typedEmail = query.toLowerCase();
  const typedIsEmail = isEmailShaped(typedEmail);
  const typedMatched = results.some((p) => p.email === typedEmail);
  const showList = open && query.length >= MIN_QUERY;

  const add = (person) => {
    if (!person || pickedIds.has(person.id)) return;
    onChange([...picked, { id: person.id, name: person.name ?? null, email: person.email ?? null }]);
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
      const exact = options.find((p) => p.email === typedEmail);
      if (exact) { add(exact); return; }
      if (typedIsEmail) setBlockedHint(true);
    } else if (e.key === 'Escape') {
      if (showList) { e.preventDefault(); e.stopPropagation(); }
      setOpen(false);
      setActive(-1);
    }
  };

  // A typed email that matches nobody in the org can't be added.
  const showBlockedHint = blockedHint || (typedIsEmail && status === 'ready' && !typedMatched);

  let statusLine = null;
  if (showList) {
    if (status === 'searching') {
      statusLine = <span className="inline-flex items-center gap-2"><Spinner /> Searching…</span>;
    } else if (status === 'unreachable') {
      statusLine = "Couldn't load people from your organization.";
    } else if (status === 'ready' && options.length === 0) {
      statusLine = 'No matches';
    }
  }

  return (
    <div className="flex flex-col gap-2">
      {picked.length > 0 && (
        <ul className="m-0 p-0 list-none flex flex-wrap gap-[6px]" aria-label="Picked people">
          {picked.map((person) => (
            <EmailChip
              key={person.id}
              label={personLabel(person)}
              removeLabel={`Remove ${person.email || personLabel(person)}`}
              onRemove={() => onChange(picked.filter((p) => p.id !== person.id))}
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
            {options.map((person, i) => (
              <li
                key={person.id}
                id={optionId(i)}
                role="option"
                aria-selected={i === active}
                // mousedown, not click: the input's blur would close the list first.
                onMouseDown={(e) => { e.preventDefault(); add(person); }}
                onMouseEnter={() => setActive(i)}
                className={`flex flex-col cursor-pointer rounded-card-row py-[6px] px-2 font-body text-[13px] ${i === active ? 'bg-surface-2' : ''}`}
              >
                {person.name && <span className="font-semibold text-ink">{person.name}</span>}
                <span className={person.name ? 'text-[11.5px] text-ink-3' : 'text-ink'}>{person.email}</span>
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
