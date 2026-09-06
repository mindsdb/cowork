// Use the published viewer's fixed light palette so controls remain consistent over arbitrary
// artifact themes.

import { Toolbar } from '@base-ui/react/toolbar';
import { Tooltip } from '../../ui';
import { CommentIcon, InboxIcon, XIcon } from './icons';

const SHADOW_TOOLBAR =
  '0 0 0 0.5px rgba(0,0,0,0.12),0 2px 2px -1px rgba(0,0,0,0.04),'
  + '0 4px 4px -2px rgba(0,0,0,0.04),'
  + 'inset 0 0 0 0.5px rgba(255,255,255,0.24),'
  + 'inset 0 -0.5px 0 rgba(255,255,255,0.16),'
  + 'inset 0 0.5px 0 rgba(255,255,255,0.24)';

// Reduced-motion animation overrides need !important to beat the inline animation style.

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
              ? 'bg-ink text-surface'
              : dim
                ? 'text-ink-3 group-hover/tb:text-ink group-hover/tb:bg-surface-2'
                : 'text-ink group-hover/tb:bg-surface-2',
          ].join(' ')}
        >
          {children}
        </span>
      </Toolbar.Button>
    </Tooltip>
  );
}

const Divider = () => (
  <Toolbar.Separator className="w-px h-[12px] bg-line shrink-0" />
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
        flex items-center gap-[2px] px-1 rounded-[46px]
        motion-reduce:!animate-none"
      style={{
        transform: 'translateX(-50%)',
        background: 'color-mix(in srgb, var(--surface) 92%, transparent)',
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
        className="h-[24px] px-2 flex items-center bg-transparent border-0 rounded-card
          cursor-pointer text-[12px] font-medium text-ink whitespace-nowrap font-[inherit]
          transition-colors hover:bg-surface-2"
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
