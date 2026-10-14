import Ico from './Icons';
import { ToggleGroup } from './ui/ToggleGroup';

const MODES = [
  { value: 'cowork', label: 'Cowork', icon: Ico.mindsdb(14) },
  { value: 'code', label: 'Code', icon: Ico.code(14) },
];

// The brand in the titlebar's sidebar zone. While Code is opt-in it carries
// the Cowork/Code switch, a segmented toggle beside the wordmark. Its labels
// show where the zone has room for them (a container query in globals.css)
// and it is icon-only otherwise. Without Code it is only the wordmark, so
// nothing appears or disappears for people who don't have Code. Compact
// (sidebar collapsed) drops the wordmark and the labels.
export default function WorkspaceBrand({ wordmark, logo, mode, showSwitch, onChange, compact = false }) {
  if (compact && !showSwitch && !logo) return null;
  return (
    <div className="app-brand">
      {logo && <img src={logo} alt="" aria-hidden="true" className="anton-sidebar__logo" />}
      {!compact && <span className="anton-sidebar__wordmark">{wordmark}</span>}
      {showSwitch && (
        <ToggleGroup
          size="sm"
          aria-label="Workspace"
          className="app-brand__switch"
          value={mode}
          onValueChange={(next) => { if (next === 'cowork' || next === 'code') onChange(next); }}
          options={MODES.map(({ value, label, icon }) => ({
            value,
            icon,
            'aria-label': label,
            title: label,
            label: compact ? null : <span className="app-brand__switch-label">{label}</span>,
          }))}
        />
      )}
    </div>
  );
}
