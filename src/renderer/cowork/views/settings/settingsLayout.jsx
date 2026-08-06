import { useContext, createContext, Children } from 'react';
import Ico from '../../components/Icons';
import { ToggleGroup } from '../../components/ui/ToggleGroup';
import { Switch } from '../../components/ui/Switch';

// Layout mode for the settings surface. Desktop (default) renders the
// two-column nav + scrolling panel inside a modal; mobile (ENG-990) renders
// a full page with accordion navigation, where each section flows naturally
// so the whole page scrolls. SettingsSectionPanel reads this to drop its
// flex-fill / internal scroll / sticky footer on mobile.
export const SettingsLayoutContext = createContext({ mobile: false });

export function Section({ title, subtitle, notice, children }) {
  const { mobile } = useContext(SettingsLayoutContext);
  // A section whose sole control is a Switch or ToggleGroup is compact enough
  // to keep the desktop "title left / control right" row on wider mobile
  // widths instead of stacking (ENG-990). Full-width controls — text inputs,
  // selects, color pickers, the generic field wrapper — stay stacked. The
  // row only re-forms above ~440px (see the media query); the narrowest
  // phones still stack everything.
  const kids = Children.toArray(children);
  const compact = kids.length === 1 && (kids[0]?.type === Switch || kids[0]?.type === ToggleGroup);
  return (
    <div className={`settings-section${compact ? ' settings-section--inline' : ''}`} style={{
      display: 'grid', gridTemplateColumns: '1fr 320px', gap: 0,
      padding: '16px 0',
      alignItems: 'flex-start',
    }}>
      {/* On mobile the grid collapses to one column (see the settings media
          query), so the inter-column gutters (paddingRight/Left: 24) would
          just indent the stacked label + control for no reason — drop them. */}
      <div style={{ paddingRight: mobile ? 0 : 24 }}>
        <h3 className="m-0 p-0 text-base font-semibold text-strong font-[inherit] leading-[1.3]">{title}</h3>
        {subtitle && <div className="text-sm text-muted mt-1">{subtitle}</div>}
        {notice && <div className="mt-2">{notice}</div>}
      </div>
      <div style={{ paddingLeft: mobile ? 0 : 24 }}>{children}</div>
    </div>
  );
}

// Shared layout shell for every settings section: scrollable content area
// on top, optional sticky footer with action buttons on the bottom.
// Pass `footer` as JSX — buttons, status text, whatever the section needs.
export function SettingsSectionPanel({ children, footer, autoSaved = false }) {
  const { mobile } = useContext(SettingsLayoutContext);
  if (mobile) {
    // Natural flow so the whole detail page scrolls (no internal scroll or
    // width cap). A sticky full-bleed bottom bar carries the action: the Save
    // footer when the section has one (always reachable on a long page instead
    // of buried at the end), or a quiet "saves automatically" note when it
    // doesn't — so an auto-save section (Appearance) doesn't read as "no way
    // to save" next to sections with a Save button (ENG-990 QA).
    const barStyle = {
      position: 'sticky',
      bottom: 0,
      zIndex: 1,
      display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap',
      // Bleed past the .settings-detail 14px gutter to the screen edges.
      margin: '16px -14px 0',
      padding: '12px 14px calc(12px + env(safe-area-inset-bottom, 0))',
      borderTop: '1px solid var(--border-subtle)',
      // Opaque so scrolling content is masked behind the bar.
      background: 'var(--bg)',
    };
    return (
      <div style={{ display: 'flex', flexDirection: 'column' }}>
        <div>{children}</div>
        {footer ? (
          <div style={{ ...barStyle, gap: 10 }}>{footer}</div>
        ) : autoSaved ? (
          <div style={{ ...barStyle, color: 'var(--text-muted)', fontSize: 12.5 }}>
            <span aria-hidden="true" style={{ display: 'inline-flex', color: 'var(--ok)' }}>
              {Ico.check ? Ico.check(13) : '✓'}
            </span>
            <span>Changes are saved automatically.</span>
          </div>
        ) : null}
      </div>
    );
  }
  return (
    <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
      <div className="scroll-clean settings-scroll flex-1 overflow-y-auto px-[28px] py-6">
        <div className="max-w-[820px]">{children}</div>
      </div>
      {footer && (
        <div className="flex items-center gap-3 px-[22px] py-3 bg-surface-glass [backdrop-filter:blur(var(--surface-glass-blur))] [-webkit-backdrop-filter:blur(var(--surface-glass-blur))] border-t border-line shrink-0">
          {footer}
        </div>
      )}
    </div>
  );
}
