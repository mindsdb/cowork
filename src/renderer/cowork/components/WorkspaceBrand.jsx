import Ico from './Icons';
import { ToggleGroup } from './ui/ToggleGroup';

const MODES = [
  { value: 'cowork', label: 'Cowork', icon: Ico.mindsdb(16) },
  { value: 'code', label: 'Code', icon: Ico.code(16) },
];

// The brand in the titlebar's sidebar zone. Where Code is available it
// carries the Cowork/Code switch, a segmented toggle beside the wordmark. Its
// labels show where the zone has room for them (a container query in
// globals.css) and it is icon-only otherwise. Without Code it is only the
// wordmark, so nothing appears or disappears where Code is off. Compact
// (sidebar collapsed) drops the wordmark and the labels.
export default function WorkspaceBrand({ wordmark, logo, mode, showSwitch, onChange, compact = false }) {
  if (compact && !showSwitch && !logo) return null;
  return (
    <div className="app-brand">
      {logo && <img src={logo} alt="" aria-hidden="true" className="anton-sidebar__logo" />}
      {!compact && <span className="anton-sidebar__wordmark">{wordmark}</span>}
      {showSwitch && (
        <ToggleGroup
          size="md"
          // Usually icon-only beside the wordmark, so the items stay compact.
          itemPadding="5px 8px"
          aria-label="Workspace"
          className="app-brand__switch"
          value={mode}
          onValueChange={(next) => { if (next === 'cowork' || next === 'code') onChange(next); }}
          options={MODES.map(({ value, label, icon }) => ({
            value,
            icon,
            'aria-label': label,
            // The labels hide when the zone is narrow or the sidebar is
            // collapsed, so hover and focus always name the mode.
            tooltip: `${label} mode`,
            label: compact ? null : <span className="app-brand__switch-label">{label}</span>,
          }))}
        />
      )}
    </div>
  );
}
