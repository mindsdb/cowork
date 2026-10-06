// Sort control for collection toolbars: a quiet `<Select>` with sort arrows,
// so it never reads as a filter. Keeps the kit's `{ id, label }` option shape
// and `onChange(id)` callback; each view supplies its own `options` because
// the sort keys vary (Projects: recent/name/most-active; Artifacts:
// newest/name; Scheduled: next-run/name). Filters go in <FilterMenu>.

import { useMemo } from 'react';
import { ArrowUpDown } from 'lucide-react';
import Select from '../ui/Select';

export function SortPill({ value, onChange, options = [], label = 'Sort' }) {
  const items = useMemo(() => options.map((o) => ({ value: o.id, label: o.label })), [options]);
  // An unknown value reads as the first option, as it always has.
  const selected = options.some((o) => o.id === value) ? value : options[0]?.id;
  return (
    <Select
      variant="quiet"
      ariaLabel={label}
      leading={<ArrowUpDown size={13} strokeWidth={1.5} />}
      value={selected}
      onValueChange={onChange}
      options={items}
      placeholder="—"
      menuMinWidth={180}
    />
  );
}
