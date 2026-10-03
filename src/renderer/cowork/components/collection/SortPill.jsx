// Sort control for collection toolbars: a thin adapter over
// `<Select variant="pill">` that keeps the kit's `{ id, label }` option shape
// and `onChange(id)` callback. Each view supplies its own `options` because the
// sort keys vary (Projects: recent/name/most-active; Artifacts: newest/name;
// Scheduled: next-run/name). Filters use `<Select variant="pill">` directly.

import { useMemo } from 'react';
import Select from '../ui/Select';

export function SortPill({ value, onChange, options = [], label = 'Sort' }) {
  const items = useMemo(() => options.map((o) => ({ value: o.id, label: o.label })), [options]);
  // An unknown value reads as the first option, as it always has.
  const selected = options.some((o) => o.id === value) ? value : options[0]?.id;
  return (
    <Select
      variant="pill"
      label={label}
      value={selected}
      onValueChange={onChange}
      options={items}
      placeholder="—"
      menuMinWidth={160}
    />
  );
}
