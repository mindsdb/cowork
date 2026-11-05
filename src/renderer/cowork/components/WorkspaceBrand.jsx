import { useLayoutEffect, useRef, useState } from 'react';

import Ico from './Icons';
import AttentionSlot from './AttentionSlot';
import ProviderIcon from './ProviderIcon';
import { Tooltip } from './ui/Tooltip';
import { ToggleGroup } from './ui/ToggleGroup';

const MODES = [
  { value: 'cowork', label: 'Cowork', icon: Ico.mindsdb(16) },
  { value: 'code', label: 'Code', icon: Ico.code(16) },
];

// A logo at least this many times wider than it is tall is read as a lockup:
// the name is part of the image, so it stands alone.
const WIDE_LOGO_RATIO = 2;

export function isWideLogo(width, height) {
  return width > 0 && height > 0 && width / height >= WIDE_LOGO_RATIO;
}

// A switch label whose width is rounded up to a whole pixel. Text widths are
// fractional; summed into the right-aligned switch, they put its 1px icon
// strokes between device pixels, where they blur and read lighter than the
// other titlebar icons on a 1x display.
function SwitchLabel({ children }) {
  const ref = useRef(null);
  const [width, setWidth] = useState(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    let alive = true;
    const measure = () => {
      if (!alive) return;
      // The text's own extent, which a width set on the span doesn't change.
      const range = document.createRange();
      range.selectNodeContents(el);
      const natural = range.getBoundingClientRect().width;
      setWidth(natural ? Math.ceil(natural) : null);
    };
    measure();
    // The web font may land after first paint and change the text's width.
    document.fonts?.ready?.then(measure);
    return () => { alive = false; };
  }, [children]);
  return (
    <span ref={ref} className="app-brand__switch-label" style={width ? { width } : undefined}>
      {children}
    </span>
  );
}

// The Cowork/Code switch, a segmented toggle in the sidebar's titlebar row.
// Its labels show where the row has room for them (a container query in
// globals.css). Compact (in the titlebar while the sidebar is hidden) it is
// icon-only. Tooltips name each mode either way.
export function WorkspaceSwitch({ mode, onChange, compact = false }) {
  return (
    <ToggleGroup
      size="md"
      itemPadding="3px 8px"
      aria-label="Workspace"
      className="app-brand__switch"
      value={mode}
      onValueChange={(next) => { if (next === 'cowork' || next === 'code') onChange(next); }}
      options={MODES.map(({ value, label, icon }) => ({
        value,
        icon,
        'aria-label': label,
        tooltip: `${label} mode`,
        label: compact ? null : <SwitchLabel>{label}</SwitchLabel>,
      }))}
    />
  );
}

// The product's name and logo, in their own row at the top of the sidebar so
// a deployment's own name has the sidebar's width rather than what the
// titlebar leaves. A name too long for the row fades out at its end. A wide
// logo is shown alone, with the name as its text alternative. The stock
// product shows its own mark. App-wide controls sit at the row's end: the
// attention slot (Code's bell portals into `attentionRef`) and search.
export function SidebarBrand({
  wordmark, logo, stockMark = false, attentionRef = null, attentionPlaceholder = false,
  onOpenSearch = null, searchShortcut = '',
}) {
  const [wideLogo, setWideLogo] = useState(null);
  const wide = Boolean(logo) && wideLogo === logo;
  return (
    <div className="app-brand">
      {logo && (
        <img
          src={logo}
          alt={wide ? wordmark : ''}
          aria-hidden={wide ? undefined : 'true'}
          className={`anton-sidebar__logo${wide ? ' is-wide' : ''}`}
          onLoad={(event) => {
            const { naturalWidth, naturalHeight } = event.currentTarget;
            setWideLogo(isWideLogo(naturalWidth, naturalHeight) ? logo : null);
          }}
        />
      )}
      {/* The bear's ink sits low in its box; the nudge centres it on the
          wordmark's capitals. */}
      {!logo && stockMark && <ProviderIcon maker="mindshub" size={26} nudgeY={-1.5} className="app-brand__mark" />}
      {!wide && <span className="anton-sidebar__wordmark">{wordmark}</span>}
      <div className="app-brand__actions">
        {attentionRef && (
          <AttentionSlot slotRef={attentionRef} className="app-brand__attention" placeholder={attentionPlaceholder} />
        )}
        {onOpenSearch && (
          <Tooltip content={searchShortcut ? `Search  (${searchShortcut})` : 'Search'}>
            <button type="button" className="icon-btn" onClick={onOpenSearch} aria-label="Search">
              {Ico.search(16)}
            </button>
          </Tooltip>
        )}
      </div>
    </div>
  );
}
