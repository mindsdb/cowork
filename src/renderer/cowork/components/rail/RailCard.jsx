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
  noChevron = false,
  headerActions = null,
  open: openProp,
  onOpenChange,
  children,
}) {
  const [openUncontrolled, setOpenUncontrolled] = useState(!!defaultOpen || noChevron);
  const open = openProp ?? openUncontrolled;
  const setOpen = onOpenChange ?? setOpenUncontrolled;

  const toggleOpen = () => setOpen(!open);

  const headerBtnStyle = {
    cursor: 'pointer',
    background: 'transparent',
    border: 0,
    padding: 0,
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    color: 'var(--ink-4)',
    flexShrink: 0,
  };

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
      ) : headerActions ? (
        <div style={{
          display: 'flex', alignItems: 'center', gap: 6,
          padding: '11px 14px', width: '100%',
        }}>
          <button
            type="button"
            onClick={toggleOpen}
            style={{
              cursor: 'pointer',
              background: 'transparent',
              border: 0,
              padding: 0,
              flex: 1,
              minWidth: 0,
              display: 'flex',
              alignItems: 'center',
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
          </button>
          {headerActions}
          <button
            type="button"
            onClick={toggleOpen}
            aria-label={open ? 'Collapse' : 'Expand'}
            title={open ? 'Collapse' : 'Expand'}
            style={headerBtnStyle}
          >
            {open ? Ico.chevDown(12) : Ico.chevRight(12)}
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={toggleOpen}
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
