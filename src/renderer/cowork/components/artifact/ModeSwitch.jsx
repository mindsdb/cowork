// A two-way mode switch (ENG-4383): Live edit's Navigate / Edit text and
// Comments' Navigate / Comment. Navigate always leaves the page working as a
// page; the other mode turns clicks into editing or commenting. Comments'
// floats as a pill at the bottom centre of the artifact; Live edit's sits in
// its side panel as a segmented control (`floating` false).

import { Toolbar } from '@base-ui/react/toolbar';
import { Tooltip } from '../ui';

// A light glass pill that reads the same over any artifact.
const SHADOW =
  '0 0 0 0.5px rgba(0,0,0,0.12),0 2px 2px -1px rgba(0,0,0,0.04),'
  + '0 4px 4px -2px rgba(0,0,0,0.04),'
  + 'inset 0 0 0 0.5px rgba(255,255,255,0.24),'
  + 'inset 0 -0.5px 0 rgba(255,255,255,0.16),'
  + 'inset 0 0.5px 0 rgba(255,255,255,0.24)';

function ModeButton({ on, icon, label, hint, onClick, fill = false }) {
  return (
    <Tooltip content={hint}>
      <Toolbar.Button
        aria-pressed={on}
        onClick={onClick}
        className={[
          'h-[24px] px-[10px] flex items-center gap-[6px] rounded-full border-0 cursor-pointer',
          fill ? 'flex-1 justify-center' : '',
          'text-[12px] font-medium whitespace-nowrap font-[inherit]',
          'transition-[background,color] duration-hover',
          on ? 'bg-ink text-surface' : 'bg-transparent text-ink hover:bg-surface-2',
        ].join(' ')}
      >
        {icon}
        <span>{label}</span>
      </Toolbar.Button>
    </Tooltip>
  );
}

/**
 * @param {{ ariaLabel: string, value: string, onChange: (value: string) => void,
 *   options: { value: string, icon: import('react').ReactNode, label: string, hint: string }[],
 *   className?: string, floating?: boolean }} props
 */
export function ModeSwitch({ ariaLabel, value, options, onChange, className = '', floating = true }) {
  const buttons = options.map((option) => (
    <ModeButton
      key={option.value}
      on={value === option.value}
      icon={option.icon}
      label={option.label}
      hint={option.hint}
      fill={!floating}
      onClick={() => { if (value !== option.value) onChange(option.value); }}
    />
  ));
  if (!floating) {
    return (
      <Toolbar.Root
        aria-label={ariaLabel}
        className={`artifact-mode-switch flex h-[30px] items-center gap-[2px] rounded-full border border-solid border-line
          bg-surface p-[2px] ${className}`}
        style={{ fontFamily: 'var(--font-body)' }}
      >
        {buttons}
      </Toolbar.Root>
    );
  }
  return (
    <Toolbar.Root
      aria-label={ariaLabel}
      className={`artifact-mode-switch absolute left-1/2 bottom-[24px] z-20 h-[32px]
        flex items-center gap-[2px] px-1 rounded-[46px] motion-reduce:!animate-none ${className}`}
      style={{
        transform: 'translateX(-50%)',
        background: 'color-mix(in srgb, var(--surface) 92%, transparent)',
        backdropFilter: 'blur(5.6px)',
        WebkitBackdropFilter: 'blur(5.6px)',
        boxShadow: SHADOW,
        fontFamily: 'var(--font-body)',
        animation: 'cw-act-bar-in var(--dur-layout) var(--ease-out)',
      }}
    >
      {buttons}
    </Toolbar.Root>
  );
}

export default ModeSwitch;
