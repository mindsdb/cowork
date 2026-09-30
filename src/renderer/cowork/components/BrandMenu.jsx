import Ico from './Icons';
import Menu from './ui/Menu';

const MODES = [
  { value: 'cowork', label: 'Cowork', icon: Ico.mindsdb(15) },
  { value: 'code', label: 'Code', icon: Ico.code(15) },
];

// The brand in the titlebar's sidebar zone. While Code is opt-in it is also
// the Cowork/Code switch: the wordmark opens a menu of workspaces, the way a
// workspace switcher sits on the brand in most multi-product apps. Without
// Code it is only the wordmark, so nothing appears or disappears for people
// who don't have Code.
export default function BrandMenu({ wordmark, logo, mode, showSwitch, onChange, compact = false }) {
  const current = MODES.find((m) => m.value === mode) || MODES[0];
  const mark = (
    <>
      {logo && <img src={logo} alt="" aria-hidden="true" className="anton-sidebar__logo" />}
      {!compact && <span className="anton-sidebar__wordmark">{wordmark}</span>}
    </>
  );

  if (!showSwitch) {
    return compact && !logo ? null : <div className="app-brand">{mark}</div>;
  }

  return (
    <Menu
      ariaLabel="Workspace"
      side="bottom"
      align="start"
      width={200}
      trigger={(
        <button type="button" className="app-brand app-brand--menu" aria-label={`Workspace: ${current.label}`}>
          {mark}
          <span className="app-brand__mode">
            {compact && <span className="inline-flex">{current.icon}</span>}
            {/* Every mode label is stacked in one grid cell and only the
                current one is visible, so the pill is always as wide as the
                longest label and switching modes never shifts the row. */}
            {!compact && (
              <span className="app-brand__mode-labels">
                {MODES.map((m) => (
                  <span key={m.value} className={m.value === mode ? 'is-current' : undefined} aria-hidden={m.value === mode ? undefined : 'true'}>
                    {m.label}
                  </span>
                ))}
              </span>
            )}
          </span>
          <span className="app-brand__chevron">{Ico.chevDown(13)}</span>
        </button>
      )}
      items={MODES.map((m) => ({
        id: m.value,
        icon: m.icon,
        label: m.label,
        hint: m.value === mode ? '✓' : undefined,
        aria: m.value === mode ? { 'aria-current': 'true' } : undefined,
        onClick: () => { if (m.value !== mode) onChange(m.value); },
      }))}
    />
  );
}
