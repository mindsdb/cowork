// `<ModelSelect>` — searchable, provider-grouped model picker (ENG-1096).
//
// The domain half of the picker: sections from the backend's `provider` field
// with the maker inferred from alias+label for the icon (`lib/modelCatalog`,
// which explains why one field can't do both), provider marks (`ProviderIcon`,
// neutral placeholder for makers without an svg — ENG-1112), and the pin
// semantics for the stale-pin / "Other…" entries. All Base UI wiring and
// styling live in the generic `ui/Combobox` this composes.
//
// API mirrors `Select` where the two overlap, so call sites swap 1:1:
//
//   <ModelSelect
//     value={modelId}
//     onValueChange={setModelId}
//     options={[
//       { value: 'sonnet', label: 'Claude Sonnet 5' },
//       { value: 'opus', label: 'Claude Opus 5', tag: 'Needs credits' },
//       { value: '__custom__', label: 'Other…', pin: 'bottom' },
//     ]}
//   />
//
// Option shape: { value, label, disabled?, title?, tag?, maker?, provider?, pin? }.
//   - `provider`: MindsHub's serving-vendor field (the ENG-1111 backend
//     contract), which decides the section.
//   - `maker`: explicit maker key, trusted over inference when present. It is
//     the icon identity only, never the section.
//   - `tag`: compact right-aligned pill on the row (the version state, the
//     "Needs credits" wallet state, or both), kept out of the label so the
//     trigger and the search see the bare name.
//   - `pin: 'top' | 'bottom'`: render outside the maker groups, unheaded,
//     at the top/bottom of the list (stale-pin and "Other…" entries).
//     Pinned entries also bypass the search filter: "Other…" is the escape
//     hatch for typing a model id we don't list, so a search with no
//     matches must not hide it.

import { useMemo } from 'react';
import { cn } from '../lib/cn';
import { groupModelOptions, modelMaker } from '../lib/modelCatalog';
import Combobox from './ui/Combobox.jsx';
import ProviderIcon from './ProviderIcon.jsx';

// Pseudo-group keys for pinned (unheaded) entries. Underscored so they can
// never collide with a real maker key from modelCatalog.
const PIN_TOP = '__pinned-top__';
const PIN_BOTTOM = '__pinned-bottom__';

function makerKeyFor(option) {
  if (!option) return 'other';
  if (option.pin) return 'other'; // specials get the neutral mark
  return option.maker || modelMaker(option.value, option.label).key;
}

export function ModelSelect({
  options = [],
  placeholder = 'Select model',
  emptyText = 'No models found',
  ...rest
}) {
  const groups = useMemo(() => {
    const entries = options.filter(Boolean);
    const top = entries.filter((o) => o.pin === 'top');
    const bottom = entries.filter((o) => o.pin === 'bottom');
    const grouped = groupModelOptions(entries.filter((o) => !o.pin));
    return [
      ...(top.length ? [{ key: PIN_TOP, name: null, items: top }] : []),
      ...grouped,
      ...(bottom.length ? [{ key: PIN_BOTTOM, name: null, items: bottom }] : []),
    ];
  }, [options]);

  return (
    <Combobox
      groups={groups}
      placeholder={placeholder}
      emptyText={emptyText}
      searchAriaLabel="Search models"
      // Match on the display label OR the raw id — "opus" finds Claude Opus
      // whether typed as alias or name. Pinned entries bypass the filter.
      filter={(item, query, contains) => !!item?.pin || contains(item?.label ?? '', query) || contains(item?.value ?? '', query)}
      renderValue={(selected) => (
        <>
          {selected && <ProviderIcon maker={makerKeyFor(selected)} className="text-ink-2" />}
          <span className={cn('truncate', !selected && 'text-ink-4')}>
            {selected ? selected.label : placeholder}
          </span>
        </>
      )}
      {...rest}
    />
  );
}

export default ModelSelect;
