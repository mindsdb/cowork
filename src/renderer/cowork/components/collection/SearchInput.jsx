// Standard search input for collection toolbars. The styling matches
// the Projects flavour (single-line input with a leading magnifier
// glyph and a trailing ⌘K shortcut hint). Width flexes within
// FilterRow's flex container; pass a custom `placeholder` per view.

import Ico from '../Icons';
import { Kbd } from '../ui';

const FONT_BODY = 'var(--font-body)';

export function SearchInput({
  value,
  onChange,
  inputRef,
  placeholder = 'Search',
  shortcut = '⌘K',
}) {
  return (
    <div style={{
      flex: '0 1 320px', minWidth: 220,
      display: 'inline-flex', alignItems: 'center', gap: 8,
      padding: '7px 11px', borderRadius: 7,
      background: 'var(--surface-2)',
      border: '1px solid var(--line)',
    }}>
      <span style={{ display: 'inline-flex', flexShrink: 0, color: 'var(--ink-3)' }}>
        {Ico.search(13)}
      </span>
      <input
        ref={inputRef}
        type="text"
        value={value || ''}
        onChange={(e) => onChange?.(e.target.value)}
        placeholder={placeholder}
        style={{
          flex: 1, minWidth: 0,
          background: 'transparent', border: 0, outline: 'none',
          fontFamily: FONT_BODY, fontSize: 12.5,
          color: 'var(--ink-2)',
        }}
      />
      {shortcut && (
        <Kbd style={{ flexShrink: 0 }}>{shortcut}</Kbd>
      )}
    </div>
  );
}
