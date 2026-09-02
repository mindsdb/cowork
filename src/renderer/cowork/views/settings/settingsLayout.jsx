import { useContext, createContext, Children, useState } from 'react';
import Ico from '../../components/Icons';
import { ToggleGroup } from '../../components/ui/ToggleGroup';
import { Switch } from '../../components/ui/Switch';

// Layout mode for the settings surface. Desktop (default) renders the
// two-column nav + scrolling panel inside a modal; mobile (ENG-990) renders
// a full page with accordion navigation, where each section flows naturally
// so the whole page scrolls. SettingsSectionPanel reads this to drop its
// flex-fill / internal scroll / sticky footer on mobile.
export const SettingsLayoutContext = createContext({ mobile: false });

// A titled card shared by settings pages. Keeping it in the canonical layout
// module lets focused settings sections live outside the already-large parent
// view without copying desktop/mobile chrome.
export function SettingsGroup({ title, children, collapsible = false, defaultCollapsed = false }) {
  const { mobile } = useContext(SettingsLayoutContext);
  const [collapsed, setCollapsed] = useState(collapsible && defaultCollapsed);
  const headingClass =
    'm-0 font-[family-name:var(--font-sans)] text-sm font-semibold tracking-[0.04em] uppercase text-ink-3';
  const heading = collapsible ? (
    <button
      type="button"
      onClick={() => setCollapsed((current) => !current)}
      aria-expanded={!collapsed}
      className="inline-flex items-center gap-1 border-0 bg-transparent p-0 cursor-pointer text-inherit"
    >
      <span className={`inline-flex shrink-0 text-ink-4 transition-transform ${collapsed ? '' : 'rotate-90'}`} aria-hidden="true">
        {Ico.chevRight(12)}
      </span>
      {title}
    </button>
  ) : title;
  if (mobile) {
    return (
      <div className="mb-1.5">
        <h2 className={`${headingClass} pt-3 px-0.5 pb-2`}>{heading}</h2>
        {!collapsed && <div className="pt-0 px-0.5 pb-1">{children}</div>}
      </div>
    );
  }
  return (
    <div className="border border-solid border-line rounded-card bg-surface-glass backdrop-blur-[var(--surface-glass-blur)] mb-[14px] overflow-hidden">
      <h2 className={`${headingClass} pt-[14px] px-[18px] ${collapsed ? 'pb-[14px]' : 'pb-0'}`}>{heading}</h2>
      {!collapsed && <div className="pt-2.5 px-[18px] pb-2">{children}</div>}
    </div>
  );
}

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
    <div className={`settings-section${compact ? ' settings-section--inline' : ''} grid grid-cols-[1fr_320px] gap-0 py-4 items-start`}>
      {/* On mobile the grid collapses to one column (see the settings media
          query), so the inter-column gutters (pr-6/pl-6) would just indent
          the stacked label + control for no reason — drop them. */}
      <div className={mobile ? undefined : 'pr-6'}>
        <h3 className="m-0 p-0 text-base font-semibold text-ink leading-[1.3]">{title}</h3>
        {subtitle && <div className="text-sm text-ink-3 mt-1">{subtitle}</div>}
        {notice && <div className="mt-2">{notice}</div>}
      </div>
      <div className={mobile ? undefined : 'pl-6'}>{children}</div>
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
    // Bleed past the .settings-detail 14px gutter to the screen edges;
    // opaque bg so scrolling content is masked behind the bar.
    const barClass =
      'sticky bottom-0 z-[1] flex items-center flex-wrap ' +
      'mt-4 mx-[-14px] mb-0 pt-3 px-[14px] pb-[calc(12px+env(safe-area-inset-bottom,0px))] ' +
      'border-t border-x-0 border-b-0 border-solid border-line bg-bg';
    return (
      <div className="flex flex-col">
        <div>{children}</div>
        {footer ? (
          <div className={`${barClass} gap-2.5`}>{footer}</div>
        ) : autoSaved ? (
          <div className={`${barClass} gap-2 text-ink-3 text-sm`}>
            <span aria-hidden="true" className="inline-flex text-[var(--ok)]">
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
      <div className="scroll-clean settings-scroll flex-1 overflow-y-auto py-6 px-7">
        <div className="max-w-[820px]">{children}</div>
      </div>
      {footer && (
        <div className="flex items-center gap-2.5 py-3 px-[22px] bg-surface-glass backdrop-blur-[var(--surface-glass-blur)] border-t border-x-0 border-b-0 border-solid border-line shrink-0">
          {footer}
        </div>
      )}
    </div>
  );
}
