// Bubble container used by every right-rail section in chat and
// project views. The same surface, border, radius, and header treatment
// across both views so they read as one design family.
//
// Two visual variants:
//   default — bubble with a divider between header and body.
//   slim    — bubble keeps surface + border + radius, but drops the
//             divider so the header reads as one continuous line above
//             the body (used for Context per spec).
//
// Body always has maxBodyHeight + overflow-y: auto so a long card
// scrolls inside itself rather than pushing the rail off-screen.

import { useState } from 'react';
import Ico from '../Icons';

const FONT_BODY = "'Inter', system-ui, sans-serif";

export function RailCard({
  title,
  defaultOpen = false,
  slim = false,
  maxBodyHeight = 320,
  // When true, the header is a plain (non-clickable) label and the
  // chevron disclosure widget is dropped. The body is always shown
  // (defaultOpen is implicitly true). Used by the data-vault Connect
  // panel where the only dismissal affordance should be the × in the
  // outer wrapper, not a separate collapse control.
  noChevron = false,
  children,
}) {
  const [open, setOpen] = useState(!!defaultOpen || noChevron);
  return (
    <div style={{
      background: 'var(--surface)',
      border: '1px solid var(--line)',
      borderRadius: 12,
      overflow: 'hidden',
      flexShrink: 0,
    }}>
      {noChevron ? (
        <div style={{
          padding: '11px 14px',
          width: '100%',
          display: 'flex',
          alignItems: 'center',
          textAlign: 'left',
        }}>
          <span style={{
            fontFamily: FONT_BODY, fontSize: 13, fontWeight: 600,
            color: 'var(--ink)', letterSpacing: '-0.005em',
            minWidth: 0, flex: 1,
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}>
            {title}
          </span>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          style={{
            cursor: 'pointer',
            background: 'transparent',
            border: 0,
            padding: '11px 14px',
            width: '100%',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            textAlign: 'left',
            font: 'inherit',
            color: 'inherit',
          }}
        >
          <span style={{
            fontFamily: FONT_BODY, fontSize: 13, fontWeight: 600,
            color: 'var(--ink)', letterSpacing: '-0.005em',
            minWidth: 0, flex: 1,
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}>
            {title}
          </span>
          <span
            style={{ color: 'var(--ink-4)', display: 'inline-flex', flexShrink: 0 }}
            title={open ? 'Collapse' : 'Expand'}
          >
            {open ? Ico.chevDown(12) : Ico.chevRight(12)}
          </span>
        </button>
      )}
      {open && (
        <div style={{
          padding: '4px 14px 14px',
          // slim drops the divider so the header reads as one
          // continuous line above the body (Context per spec).
          borderTop: slim ? 'none' : '1px solid var(--line)',
          maxHeight: maxBodyHeight,
          overflowY: 'auto',
        }}>
          {children}
        </div>
      )}
    </div>
  );
}
