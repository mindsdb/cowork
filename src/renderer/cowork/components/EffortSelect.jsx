// `<EffortSelect>` — the reasoning-effort sub-picker that sits beside
// ModelSelect (ENG-1940). Renders nothing when the current model has no
// entry in `modelEfforts` (settings.modelEfforts — the single source of
// truth for which models accept an effort level; see SettingsView.jsx's
// own per-role effort picker, the sibling implementation this mirrors) or
// when the active harness is Hermes (no effort knob there either — same
// gate as SettingsView's `harnessSupportsEffort`).
//
// `autoOpenKey` — pass the model id every time it changes; this component
// opens itself whenever that key changes AND the new model has effort
// options, satisfying "select a model that has effort → the effort picker
// expands" without the caller having to track open-state timing itself.
// A key that arrives already carrying effort options (e.g. the per-task
// picker mounting on a task whose model already supports effort) does NOT
// auto-open — only a *change* does, so re-opening a task doesn't pop the
// menu unprompted.

import { useEffect, useRef, useState } from 'react';
import { Select } from './ui';

export function EffortSelect({
  modelId,
  modelEfforts,
  harness,
  value,
  onValueChange,
  autoOpenKey,
  className,
}) {
  const [open, setOpen] = useState(false);
  const lastAutoOpenKey = useRef(autoOpenKey);

  const harnessSupportsEffort = (harness || 'anton') !== 'hermes';
  const entry = (modelEfforts || {})[modelId];
  const options = entry?.efforts || [];
  const show = harnessSupportsEffort && options.length > 0;

  const resolvedValue = options.includes(value) ? value : (entry?.default || options[0] || '');

  useEffect(() => {
    if (autoOpenKey === undefined || autoOpenKey === lastAutoOpenKey.current) return;
    lastAutoOpenKey.current = autoOpenKey;
    if (show) setOpen(true);
  }, [autoOpenKey, show]);

  if (!show) return null;

  return (
    <Select
      value={resolvedValue}
      onValueChange={(v) => { onValueChange?.(v); setOpen(false); }}
      open={open}
      onOpenChange={setOpen}
      options={options.map((lvl) => ({ value: lvl, label: lvl.charAt(0).toUpperCase() + lvl.slice(1) }))}
      variant="unstyled"
      className={className}
      ariaLabel="Reasoning effort"
      title="Reasoning effort for this task. Higher effort trades latency/cost for deeper reasoning."
    />
  );
}

export default EffortSelect;
