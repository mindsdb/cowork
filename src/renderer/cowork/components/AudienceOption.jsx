// The radio cards "who can open / use this" is picked from: the artifact
// Share panel's "Who can access your app" and the skill audience.
// Each card is an icon tile, a title, a subtitle and a radio dot. A card
// whose choice needs more (picking teams and people) unfolds its editor right
// under itself, joined to it, rather than at the bottom of the list.
//
// Must sit inside a Base UI `<RadioGroup>`.

import { Radio } from '@base-ui/react/radio';
import clsx from 'clsx';
import { useFold } from '../hooks/useFold';

// Keys the radio group would take for its own arrow navigation. Typing in an
// editor inside the group must keep them.
const GROUP_KEYS = new Set(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Home', 'End']);

export function AudienceOptionCard({ value, active, icon, title, desc, disabled = false, attached = false }) {
  return (
    <Radio.Root
      value={value}
      disabled={disabled}
      style={{
        display: 'flex', alignItems: 'center', gap: 10, width: '100%',
        textAlign: 'left', cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.6 : 1,
        padding: '10px 12px', borderRadius: 'var(--card-radius)',
        // Joined to the editor unfolding beneath it.
        ...(attached && { borderBottomLeftRadius: 0, borderBottomRightRadius: 0 }),
        background: active ? 'var(--accent-bg)' : 'var(--surface-2)',
        border: `1px solid ${active ? 'var(--accent)' : 'var(--line)'}`,
        transition: 'background var(--dur-hover) ease, border-color var(--dur-hover) ease',
      }}
    >
      <span
        className="inline-grid place-items-center shrink-0 w-[30px] h-[30px] rounded-card-row bg-surface border border-solid border-line"
        style={{ color: active ? 'var(--accent)' : 'var(--ink-3)' }}
      >{icon}</span>
      <span className="min-w-0 flex-1">
        <span className="block font-body font-semibold text-[13px] text-ink">{title}</span>
        <span className="block font-body text-[11.5px] text-ink-3 mt-px">{desc}</span>
      </span>
      {/* Radio dot, driven by the controlled `active` so its border color
          stays a plain inline style (no data-attribute stylesheet). */}
      <span
        className="shrink-0 w-[16px] h-[16px] rounded-full inline-grid place-items-center"
        style={{
          border: `1.5px solid ${active ? 'var(--accent)' : 'var(--ink-4)'}`,
          transition: 'border-color var(--dur-hover) ease',
        }}
      >
        {active && <span className="w-[8px] h-[8px] rounded-full bg-accent" />}
      </span>
    </Radio.Root>
  );
}

/** The editor under a card: unfolds by height when `open`, joined to the
    card above it. */
export function AudienceOptionEditor({ open, children, testId }) {
  const { mounted, folded } = useFold(open);
  if (!mounted) return null;
  return (
    <div
      className={clsx('fold', folded && 'is-folded')}
      data-testid={testId}
      // Arrow keys typed in the editor are the editor's, not the radio group's.
      onKeyDown={(e) => { if (GROUP_KEYS.has(e.key)) e.stopPropagation(); }}
    >
      <div className="fold__inner">
        <div
          className="rounded-b-card border border-t-0 border-solid border-accent bg-accent-bg pt-[2px] pb-[10px] px-3"
        >
          {children}
        </div>
      </div>
    </div>
  );
}

/** A card and, when it has one, the editor that unfolds under it. */
export function AudienceOption({ editor = null, editorTestId, ...card }) {
  const expanded = !!editor && card.active;
  return (
    <div className="flex flex-col">
      <AudienceOptionCard {...card} attached={expanded} />
      {editor && <AudienceOptionEditor open={card.active} testId={editorTestId}>{editor}</AudienceOptionEditor>}
    </div>
  );
}

export default AudienceOption;
