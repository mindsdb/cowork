// Cmd+K search. A `Modal` (Base UI Dialog: focus trap + restore, Esc and
// outside-press close) around a `Command` list (Base UI Autocomplete: arrow
// keys, hover highlight, Enter opens). Results come from the server
// (`onSearch` = api.searchCowork) and are grouped by type in order of first
// appearance, keeping the server's ranking inside each group.
import { useEffect, useMemo, useState } from 'react';
import Ico from './Icons';
import { Command, CommandFooter, CommandGroup, CommandInput, CommandItem, CommandList, CommandStatus, Kbd, Tooltip } from './ui';
import { Modal } from './ui/Modal';
import { productName } from '../../lib/deploymentBrand';
import { STOCK_PRODUCT_NAME } from '../../../shared/product-name';
import { useTranslation } from '../../lib/i18n';

const PRODUCT_NAME = productName(STOCK_PRODUCT_NAME);

// `label` is a message key; translated when the groups are built.
const TYPES = {
  task: { label: 'search.types.task', icon: Ico.list },
  project: { label: 'search.types.project', icon: Ico.folder },
  artifact: { label: 'search.types.artifact', icon: Ico.sparkle },
  attachment: { label: 'search.types.attachment', icon: Ico.attach },
  schedule: { label: 'search.types.schedule', icon: Ico.clock },
  pin: { label: 'search.types.pin', icon: Ico.pin },
};

function groupByType(results, t) {
  const groups = new Map();
  for (const result of results) {
    if (!groups.has(result.type)) {
      const label = TYPES[result.type] ? t(TYPES[result.type].label) : `${result.type.charAt(0).toUpperCase()}${result.type.slice(1)}`;
      groups.set(result.type, { key: result.type, label, items: [] });
    }
    groups.get(result.type).items.push(result);
  }
  return [...groups.values()];
}

export default function SearchModal({ open, onClose, onSearch, onSelect, recents }) {
  const { t } = useTranslation('shell');
  const LABEL = t('search.label', { product: PRODUCT_NAME });
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  // Before anything is typed, recent tasks and projects are the starting list.
  const showRecents = !query.trim() && recents?.length > 0;
  const groups = useMemo(() => (showRecents
    ? groupByType(recents, t).map((g) => ({ ...g, label: g.key === 'task' ? t('search.recentTasks') : g.label }))
    : groupByType(results, t)), [showRecents, recents, results, t]);

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
        setError(err.message || t('search.failed'));
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
      ariaLabel={t('search.ariaLabel')}
      width="min(620px, calc(100vw - 32px))"
      maxHeight="min(680px, calc(100vh - 80px))"
    >
      <Command items={groups} mode="none" value={query} onValueChange={setQuery} itemToStringValue={(r) => r.title}>
        <CommandInput
          type="search"
          placeholder={LABEL}
          aria-label={LABEL}
          leading={Ico.search(16)}
          trailing={(
            <Tooltip content={t('ui.modal.close')}>
              <button type="button" className="mini-icon-btn" aria-label={t('ui.modal.close')} onClick={onClose}>{Ico.close(14)}</button>
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
        {busy && <CommandStatus>{t('search.searching')}</CommandStatus>}
        {error && <div className="dialog-error">{error}</div>}
        {!busy && query.trim() && results.length === 0 && !error && <CommandStatus>{t('search.noResults', { product: PRODUCT_NAME })}</CommandStatus>}
        {!query.trim() && !showRecents && <CommandStatus>{t('search.hint')}</CommandStatus>}
        <CommandFooter>
          <span><Kbd>↑</Kbd> <Kbd>↓</Kbd> {t('search.toNavigate')}</span>
          <span><Kbd>↵</Kbd> {t('search.toOpen')}</span>
          <span><Kbd>esc</Kbd> {t('search.toClose')}</span>
        </CommandFooter>
      </Command>
    </Modal>
  );
}
