// `<Select>` — token-skinned dropdown select built on Base UI.
//
// Why a library here: the hand-rolled selects across the app were either
// bare native `<select>` elements (inconsistent padding/chevron per call
// site) or a "transparent `<select>` overlaid on a styled pill" trick
// (ConnectorPicker's `SelectPill`, the ConnectWorkflowView filter/sort
// controls) that fakes a custom look while keeping the OS popup — fine
// until you want consistent styling, real keyboard support, or a divider
// between options. Base UI's Select gives us a fully custom, accessible
// popup (arrow keys, typeahead, focus management) while we own only the
// skin, wired to the same CSS variables (`--surface`, `--ink-2`, `--line`,
// `--danger`) the rest of the app uses — the same pattern `ui/Menu.jsx`
// already established for dropdown menus.
//
// API is options-array driven (mirrors `Menu`'s `items` prop) rather than
// compound children — nearly every call site already builds its options
// via `.map()` over an existing list, so handing in that array is less
// code than wrapping each entry in a `<Select.Item>`.
//
//   <Select
//     value={sortBy}
//     onValueChange={setSortBy}
//     options={[
//       { value: 'name', label: 'Name' },
//       { value: 'date', label: 'Date' },
//       { separator: true },
//       { value: 'x', label: 'X', disabled: true },
//     ]}
//   />
//
// Option shape: { value, label, disabled?, title? }. `{ separator: true }`
// renders a divider. `{ group, options }` renders a labeled group (only
// used if a call site needs it — none currently do).
//
// Two visual variants:
//   - `variant="field"` (default) — full-width bordered control, matches
//     the form fields it replaces (settings-select, channels-input, etc).
//   - `variant="pill"` — compact "Label: value ⌄" control, replaces the
//     SelectPill / customize-select overlay trick used for sort/filter.

import { useEffect, useMemo } from 'react';
import { Select as BaseSelect } from '@base-ui/react/select';

let _SELECT_CSS_INJECTED = false;
function _ensureSelectCss() {
  if (_SELECT_CSS_INJECTED) return;
  if (typeof document === 'undefined') return;
  const style = document.createElement('style');
  style.setAttribute('data-cw-select', '');
  style.textContent = `
.cw-select-trigger {
  display: inline-flex; align-items: center; justify-content: space-between;
  gap: 10px;
  font-family: var(--font-body);
  background: var(--surface);
  border: 1px solid var(--line);
  border-radius: var(--r);
  color: var(--ink);
  cursor: pointer;
  outline: none;
  box-sizing: border-box;
  transition: border-color .12s ease, box-shadow .15s ease;
}
.cw-select-trigger:hover               { border-color: var(--line-2); }
.cw-select-trigger:focus-visible       { border-color: var(--accent); box-shadow: var(--ring); }
.cw-select-trigger[data-disabled]      { opacity: 0.55; cursor: not-allowed; }
.cw-select-trigger[aria-invalid="true"] {
  border-color: #E07060;
  box-shadow: 0 0 0 1px rgba(224,112,96,0.45);
}

.cw-select-trigger--field {
  width: 100%;
  padding: 7px 10px;
  font-size: 13px;
}
.cw-select-trigger--field.cw-select-trigger--sm { padding: 5px 8px; font-size: 12px; }

.cw-select-trigger--pill {
  border-radius: 7px;
  padding: 7px 11px;
  background: var(--surface-2);
  color: var(--ink-2);
  font-size: 12.5px;
}
.cw-select-pill-label { color: var(--ink-4); font-size: 11.5px; }
.cw-select-value       { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.cw-select-icon         { display: inline-flex; flex-shrink: 0; color: var(--ink-3); }

.cw-select-backdrop { position: fixed; inset: 0; }

.cw-select-positioner { box-sizing: border-box; outline: none; }

.cw-select-popup {
  min-width: var(--anchor-width, 160px);
  max-height: var(--available-height, 320px);
  overflow-y: auto;
  background: var(--surface);
  border: 1px solid var(--line);
  border-radius: 10px;
  box-shadow: 0 12px 32px rgba(15,16,17,0.28), 0 1px 0 rgba(15,16,17,0.04);
  padding: 4px 0;
  outline: none;
  font-family: var(--font-body);
  transform-origin: var(--transform-origin);
}
.cw-select-popup[data-open]   { animation: cw-select-in 130ms ease-out; }
.cw-select-popup[data-closed] { animation: cw-select-out 90ms ease-in; }
@keyframes cw-select-in  { from { opacity: 0; transform: scale(0.97); } to   { opacity: 1; transform: scale(1); } }
@keyframes cw-select-out { from { opacity: 1; transform: scale(1); }    to   { opacity: 0; transform: scale(0.97); } }

.cw-select-item {
  display: flex; align-items: center; gap: 8px;
  width: calc(100% - 8px); margin: 0 4px;
  padding: 8px 10px; border-radius: 5px;
  font-size: 13px; color: var(--ink-2);
  cursor: pointer; user-select: none; outline: none;
  box-sizing: border-box;
}
.cw-select-item[data-highlighted] { background: var(--surface-2); }
.cw-select-item[data-disabled]    { opacity: 0.55; cursor: not-allowed; }
.cw-select-item-text  { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.cw-select-item-check { display: inline-flex; flex-shrink: 0; color: var(--accent); visibility: hidden; }
.cw-select-item[data-selected] .cw-select-item-check { visibility: visible; }
.cw-select-sep         { height: 1px; background: var(--line); margin: 4px 0; }
.cw-select-group-label { padding: 6px 14px 2px; font-size: 11px; font-weight: 600; color: var(--ink-4); text-transform: uppercase; letter-spacing: 0.04em; }
`;
  document.head.appendChild(style);
  _SELECT_CSS_INJECTED = true;
}

const CHEVRON_DOWN = (
  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <path d="M6 9l6 6 6-6" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

const CHECK = (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <path d="M5 13l4 4L19 7" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

// Flattens the options tree (unwrapping groups, dropping separators) into
// the `{ value, label }` pairs Base UI's Root `items` prop wants — that's
// what lets `<Select.Value>` resolve the selected item's label instead of
// echoing back the raw value.
function flattenForLabels(options) {
  const out = [];
  for (const opt of options) {
    if (!opt || opt.separator) continue;
    if (Array.isArray(opt.options)) {
      out.push(...flattenForLabels(opt.options));
      continue;
    }
    out.push({ value: opt.value, label: opt.label });
  }
  return out;
}

function renderOptions(options) {
  return options.filter(Boolean).map((opt, i) => {
    if (opt.separator) {
      return <BaseSelect.Separator key={`sep-${i}`} className="cw-select-sep" />;
    }

    if (Array.isArray(opt.options)) {
      return (
        <BaseSelect.Group key={opt.group ?? i} className="cw-select-group">
          <BaseSelect.GroupLabel className="cw-select-group-label">{opt.group}</BaseSelect.GroupLabel>
          {renderOptions(opt.options)}
        </BaseSelect.Group>
      );
    }

    return (
      <BaseSelect.Item
        key={opt.value}
        value={opt.value}
        disabled={opt.disabled}
        className="cw-select-item"
        title={opt.title}
      >
        <BaseSelect.ItemText className="cw-select-item-text">{opt.label}</BaseSelect.ItemText>
        <span className="cw-select-item-check">
          <BaseSelect.ItemIndicator>{CHECK}</BaseSelect.ItemIndicator>
        </span>
      </BaseSelect.Item>
    );
  });
}

export function Select({
  value,
  onValueChange,
  options = [],
  placeholder = 'Select…',
  // "field" = full-width bordered control (form fields).
  // "pill"  = compact "Label: value ⌄" control (sort/filter selectors).
  variant = 'field',
  size = 'md',
  disabled = false,
  // Sets aria-invalid + a danger-tinted ring on the trigger.
  invalid = false,
  // Pill-variant prefix, e.g. "Sort by". Falls back to `ariaLabel` when
  // omitted so a pill always has an accessible name.
  label,
  ariaLabel,
  title,
  id,
  name,
  width,
  minWidth,
  className,
  style,
  zIndex = 95,
  // Escape hatch — forwarded straight to the trigger button (e.g.
  // `aria-describedby` to associate an inline error message).
  ...rest
}) {
  useEffect(() => { _ensureSelectCss(); }, []);

  const itemsForLabels = useMemo(() => flattenForLabels(options), [options]);

  return (
    <BaseSelect.Root
      value={value}
      items={itemsForLabels}
      onValueChange={(next) => onValueChange?.(next)}
      disabled={disabled}
      id={id}
      name={name}
    >
      <BaseSelect.Trigger
        className={`cw-select-trigger cw-select-trigger--${variant} cw-select-trigger--${size}${className ? ` ${className}` : ''}`}
        aria-label={ariaLabel || label}
        aria-invalid={invalid || undefined}
        title={title}
        style={{ width, minWidth, ...style }}
        {...rest}
      >
        {variant === 'pill' && (label || ariaLabel) && (
          <span className="cw-select-pill-label">{label || ariaLabel}:</span>
        )}
        <BaseSelect.Value placeholder={placeholder} className="cw-select-value" />
        <BaseSelect.Icon className="cw-select-icon">{CHEVRON_DOWN}</BaseSelect.Icon>
      </BaseSelect.Trigger>
      <BaseSelect.Portal>
        <BaseSelect.Backdrop className="cw-select-backdrop" />
        <BaseSelect.Positioner
          className="cw-select-positioner"
          sideOffset={6}
          alignItemWithTrigger={false}
          style={{ zIndex }}
        >
          <BaseSelect.Popup className="cw-select-popup">
            <BaseSelect.List>
              {renderOptions(options)}
            </BaseSelect.List>
          </BaseSelect.Popup>
        </BaseSelect.Positioner>
      </BaseSelect.Portal>
    </BaseSelect.Root>
  );
}

export default Select;
