import { forwardRef } from 'react';

// Ghost icon button shared by every top-bar affordance (folder, reload,
// open-in-browser, kebab, close). forwardRef so it can be the render
// target of a Base UI Tooltip/Menu trigger (those inject a ref).
//
// `active` gives a persistent toggled-on state (accent-tinted fill + accent
// glyph) that survives mouse-leave — used by the comments switch so it reads
// as on/off, not just a hover. Hover-idle colors are resolved from `active`
// so the two states never fight over the inline background.
//
// `aria-pressed` is rendered only when a caller passes `active`: on a plain
// action or a popup trigger it would announce a toggle button that isn't one.
export const IconButton = forwardRef(function IconButton(
  { size = 30, disabled = false, active, style, children, ...rest }, ref,
) {
  const idleBg = active ? 'var(--accent-bg)' : 'transparent';
  const idleFg = active ? 'var(--accent)' : 'var(--ink-3)';
  return (
    <button
      ref={ref}
      type="button"
      disabled={disabled}
      aria-pressed={active}
      {...rest}
      style={{
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.4 : 1,
        background: idleBg, border: 0, color: idleFg,
        width: size, height: size, borderRadius: 8, flexShrink: 0,
        display: 'inline-grid', placeItems: 'center',
        transition: 'background var(--dur-hover) ease, color var(--dur-hover) ease',
        ...style,
      }}
      onMouseEnter={(e) => {
        if (!disabled) {
          e.currentTarget.style.background = active
            ? 'color-mix(in srgb, var(--accent) 22%, transparent)'
            : 'var(--surface-2)';
          e.currentTarget.style.color = active ? 'var(--accent)' : 'var(--ink)';
        }
        rest.onMouseEnter?.(e);
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = idleBg;
        e.currentTarget.style.color = idleFg;
        rest.onMouseLeave?.(e);
      }}
    >
      {children}
    </button>
  );
});

export default IconButton;
