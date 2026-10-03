// Cmd+K search. A `Modal` (Base UI Dialog: focus trap + restore, Esc and
// outside-press close) around a `Command` list (Base UI Autocomplete: arrow
// keys, hover highlight, Enter opens). Results come from the server
// (`onSearch` = api.searchCowork) and are grouped by type in order of first
// appearance, keeping the server's ranking inside each group.
import { useEffect, useMemo, useState } from 'react';
import Ico from './Icons';
import { Command, CommandFooter, CommandGroup, CommandInput, CommandItem, CommandList, CommandStatus, Kbd, Tooltip } from './ui';
import { Modal } from './ui/Modal';

const LABEL = 'Search MindsHub Cowork';

const TYPES = {
  task: { label: 'Tasks', icon: Ico.list },
  project: { label: 'Projects', icon: Ico.folder },
  artifact: { label: 'Artifacts', icon: Ico.sparkle },
  attachment: { label: 'Attachments', icon: Ico.attach },
  schedule: { label: 'Schedules', icon: Ico.clock },
  pin: { label: 'Pins', icon: Ico.pin },
};

function groupByType(results) {
  const groups = new Map();
  for (const result of results) {
    if (!groups.has(result.type)) {
      const label = TYPES[result.type]?.label || `${result.type.charAt(0).toUpperCase()}${result.type.slice(1)}`;
      groups.set(result.type, { key: result.type, label, items: [] });
    }
    groups.get(result.type).items.push(result);
  }
  return [...groups.values()];
}

export default function SearchModal({ open, onClose, onSearch, onSelect }) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const groups = useMemo(() => groupByType(results), [results]);

  useEffect(() => {
    if (!open) return;
    const timer = setTimeout(async () => {
      if (!query.trim()) {
        setResults([]);
        return;
      }
      setBusy(true);
      setError('');
      try {
        const data = await onSearch(query);
        setResults(data.results || []);
      } catch (err) {
        setError(err.message || 'Search failed.');
      } finally {
        setBusy(false);
      }
    }, 180);
    return () => clearTimeout(timer);
  }, [open, query, onSearch]);

  const choose = (result) => { onSelect(result); onClose(); };

  return (
    <Modal
      open={open}
      onClose={onClose}
      placement="top"
      layer="palette"
      ariaLabel="Search"
      width="min(620px, calc(100vw - 32px))"
      maxHeight="min(680px, calc(100vh - 80px))"
    >
      <Command items={groups} mode="none" value={query} onValueChange={setQuery} itemToStringValue={(r) => r.title}>
        <CommandInput
          type="search"
          placeholder={LABEL}
          aria-label={LABEL}
          leading={Ico.search(17)}
          trailing={(
            <Tooltip content="Close">
              <button type="button" className="mini-icon-btn" aria-label="Close" onClick={onClose}>{Ico.close(13)}</button>
            </Tooltip>
          )}
        />
        <CommandList>
          {(group) => (
            <CommandGroup key={group.key} items={group.items} label={group.label}>
              {(result) => (
                <CommandItem key={`${result.type}-${result.id}`} value={result} onClick={() => choose(result)}>
                  <span className="inline-flex shrink-0 text-ink-3">{(TYPES[result.type]?.icon || Ico.list)(15)}</span>
                  <span className="flex flex-col min-w-0 flex-1">
                    <span className="truncate text-[13.5px] font-medium text-ink">{result.title}</span>
                    {result.subtitle && <span className="truncate text-[12px] text-ink-4">{result.subtitle}</span>}
                  </span>
                </CommandItem>
              )}
            </CommandGroup>
          )}
        </CommandList>
        {busy && <CommandStatus>Searching...</CommandStatus>}
        {error && <div className="dialog-error">{error}</div>}
        {!busy && query.trim() && results.length === 0 && !error && <CommandStatus>No MindsHub Cowork results found.</CommandStatus>}
        {!query.trim() && <CommandStatus>Tasks, projects, artifacts, attachments, schedules, and pins are searchable.</CommandStatus>}
        <CommandFooter>
          <span><Kbd>↑</Kbd> <Kbd>↓</Kbd> to navigate</span>
          <span><Kbd>↵</Kbd> to open</span>
          <span><Kbd>esc</Kbd> to close</span>
        </CommandFooter>
      </Command>
    </Modal>
  );
}
