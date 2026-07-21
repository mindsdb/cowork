// Floating comments toolbar — 1:1 with the published-viewer glass toolbar
// (Figma 604-1423): a 32px light glass pill floating 34px off the bottom,
// centered over the artifact.
//
//   [ 💬 comment-mode ] [ 🗄 inbox ] │ Hide/Show comment │ [ ✕ ]
//
// The viewer top bar only ACTIVATES this chrome; everything else — entering
// comment-placement mode, opening the inbox panel, hiding markers, leaving —
// happens here. Built on Base UI's Toolbar (arrow-key navigation, toolbar
// semantics) + Tooltip; the skin is the reference's fixed light palette so
// the pill reads identically over any artifact, in either app theme.

import { Toolbar } from '@base-ui/react/toolbar';
import { Tooltip } from '../../ui';
import { CommentIcon, InboxIcon, XIcon } from './icons';

// Reference shadows (Figma "NewShadow"): outer stack + glass insets.
const SHADOW_TOOLBAR =
  '0 0 0 0.5px rgba(0,0,0,0.12),0 2px 2px -1px rgba(0,0,0,0.04),'
  + '0 4px 4px -2px rgba(0,0,0,0.04),'
  + 'inset 0 0 0 0.5px rgba(255,255,255,0.24),'
  + 'inset 0 -0.5px 0 rgba(255,255,255,0.16),'
  + 'inset 0 0.5px 0 rgba(255,255,255,0.24)';

// Entrance animation — the `cw-act-bar-in` keyframe lives in globals.css
// alongside every other keyframe in the app. `motion-reduce:!animate-none`
// (Tailwind's built-in variant) honors reduced-motion; the `!` is required
// to beat the inline `animation` style.

/**
 * 32px hit-target wrapping a 24px circle — the circle carries the hover /
 * active-press / ON states so the pill keeps its tight visual rhythm
 * (.act-tb-btn / .act-tb-c in the reference).
 */
function ToolButton({ label, on = false, dim = false, onClick, children }) {
  return (
    <Tooltip content={label}>
      <Toolbar.Button
        aria-label={label}
        aria-pressed={on}
        onClick={onClick}
        className="group/tb w-[32px] h-[32px] flex items-center justify-center bg-transparent border-0 cursor-pointer p-0"
      >
        <span
          className={[
            'w-[24px] h-[24px] rounded-full flex items-center justify-center',
            'transition-[background,color,transform] duration-150',
            'group-active/tb:scale-90',
            on
              ? 'bg-[#202021] text-white'
              : dim
                ? 'text-[#69696B] group-hover/tb:text-[#202021] group-hover/tb:bg-[rgba(32,32,33,0.08)]'
                : 'text-[#1B1B1B] group-hover/tb:bg-[rgba(32,32,33,0.08)]',
          ].join(' ')}
        >
          {children}
        </span>
      </Toolbar.Button>
    </Tooltip>
  );
}

const Divider = () => (
  <Toolbar.Separator className="w-px h-[12px] bg-[rgba(39,39,42,0.1)] shrink-0" />
);

export function CommentsToolbar({
  mode,            // comment-placement mode active in the iframe (layer echo)
  onToggleMode,
  inboxOpen,
  onToggleInbox,
  markersShown,
  onToggleMarkers,
  onClose,         // leaves the comments chrome (reopen from the top bar)
}) {
  return (
    <Toolbar.Root
      aria-label="Comments toolbar"
      className="absolute left-1/2 bottom-[34px] z-40 h-[32px]
        flex items-center gap-[2px] px-[4px] rounded-[46px]
        motion-reduce:!animate-none"
      style={{
        transform: 'translateX(-50%)',
        background: 'linear-gradient(180deg, rgba(255,255,255,0.9) 0%, rgba(241,241,241,0.9) 114.06%)',
        backdropFilter: 'blur(5.6px)',
        WebkitBackdropFilter: 'blur(5.6px)',
        boxShadow: SHADOW_TOOLBAR,
        fontFamily: 'var(--font-body)',
        animation: 'cw-act-bar-in .4s cubic-bezier(.16,1,.3,1)',
      }}
    >
      <ToolButton
        label="Comment — click an element (⌥ selects the container)"
        on={mode}
        onClick={onToggleMode}
      >
        <CommentIcon />
      </ToolButton>
      <ToolButton label="Comments inbox" on={inboxOpen} onClick={onToggleInbox}>
        <InboxIcon />
      </ToolButton>
      <Divider />
      <Toolbar.Button
        onClick={onToggleMarkers}
        className="h-[24px] px-[8px] flex items-center bg-transparent border-0 rounded-[12px]
          cursor-pointer text-[12px] font-medium text-black whitespace-nowrap
          transition-colors hover:bg-[rgba(32,32,33,0.08)]"
        style={{ fontFamily: 'inherit' }}
      >
        {markersShown ? 'Hide comment' : 'Show comment'}
      </Toolbar.Button>
      <Divider />
      <ToolButton label="Close comments" dim onClick={onClose}>
        <XIcon />
      </ToolButton>
    </Toolbar.Root>
  );
}

export default CommentsToolbar;
