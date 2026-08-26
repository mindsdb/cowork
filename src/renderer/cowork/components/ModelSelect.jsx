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
// Option shape: { value, label, disabled?, locked?, title?, tag?, maker?, provider?, pin? }.
//   - `provider`: MindsHub's serving-vendor field (the ENG-1111 backend
//     contract), which decides the section.
//   - `maker`: explicit maker key, trusted over inference when present. It is
//     the icon identity only, never the section.
//   - `tag`: compact right-aligned pill on the row (the version state, the
//     "Needs credits" wallet state, or both), kept out of the label so the
//     trigger and the search see the bare name.
//   - `locked`: the wallet can't pay for this model. Both option builders set
//     it beside `disabled: true`, and this component turns it into the "Add
//     credits" button on the row — see `creditsAction` below for why the
//     button lives here rather than in either builder.
//   - `pin: 'top' | 'bottom'`: render outside the maker groups, unheaded,
//     at the top/bottom of the list (stale-pin and "Other…" entries).
//     Pinned entries also bypass the search filter: "Other…" is the escape
//     hatch for typing a model id we don't list, so a search with no
//     matches must not hide it.

import { useMemo } from 'react';
import { cn } from '../lib/cn';
import { groupModelOptions, modelMaker } from '../lib/modelCatalog';
import { MINDS_BILLING_URL } from '../../lib/mindsUrls';
import { host } from '../../platform/host';
import { trackBillingOpened } from '../lib/analytics';
import Combobox from './ui/Combobox.jsx';
import ProviderIcon from './ProviderIcon.jsx';
import { Tooltip } from './ui';

// Pseudo-group keys for pinned (unheaded) entries. Underscored so they can
// never collide with a real maker key from modelCatalog.
const PIN_TOP = '__pinned-top__';
const PIN_BOTTOM = '__pinned-bottom__';

/*
 * The "Add credits" button on a locked row.
 *
 * A locked row is disabled, so the row itself is not a click target any more.
 * Without this the only thing naming the way out is the tag and a tooltip, and
 * neither is clickable — the user is told to add credits and given nowhere to
 * do it. Settings has a top-up link under the picker, but it renders only when
 * the CURRENT model is locked, so it stays dark for the commonest case: an
 * affordable model selected, an unaffordable one being looked at.
 *
 * It lives here rather than in either option builder because both builders are
 * pure functions in `lib/` that return data, and a button is not data. Putting
 * it in the one component both pickers already render through is also what
 * keeps Settings and the composer from drifting apart on it.
 *
 * stopPropagation on both click and mousedown mirrors the Model Router row's
 * action, but it is a second layer here rather than the guard. What stops the
 * click selecting the row is the row being disabled: Base UI's Combobox.Item
 * returns early on `disabled` before its select handler runs. No test covers
 * the stopPropagation, and none can without a `locked` row that is not also
 * disabled, which the builders never produce.
 */
function creditsAction() {
  return (
    <Tooltip content="Add credits to use this model">
      <button
        type="button"
        /* Same metrics as the "Needs credits" tag it sits beside, in accent so
           the pair reads as state then action rather than as two tags.
           `border-solid` is load-bearing: preflight is off, so a bare `border`
           sets width and leaves style at the UA default. */
        className={cn(
          'shrink-0 rounded-full border border-solid border-accent bg-transparent',
          'px-[7px] py-[1px] text-[10.5px] leading-[15px] text-accent',
          'cursor-pointer [transition:background-color_.12s_ease]',
          'hover:bg-surface-2',
        )}
        onClick={(e) => {
          e.stopPropagation();
          trackBillingOpened('locked_model_row');
          return host.openExternal(MINDS_BILLING_URL);
        }}
        onMouseDown={(e) => e.stopPropagation()}
      >
        Add credits
      </button>
    </Tooltip>
  );
}

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
    // A locked row gets the route to credits attached here, so neither builder
    // has to know how to render one. An explicit `action` from a call site wins
    // — Model Router carries its own and is never locked anyway.
    const entries = options.filter(Boolean)
      .map((o) => (o.locked && !o.action ? { ...o, action: creditsAction() } : o));
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
