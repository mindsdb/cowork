/** @type {import('tailwindcss').Config} */
//
// Cowork — Tailwind config.
//
// We don't use Tailwind for the existing app surfaces (those rely on
// inline styles + globals.css). Tailwind is wired in here so that
// components ported from mdb-ai (Markdown stack, ThinkingBlock, etc.)
// can use their utility classes verbatim, and so future migration of
// existing surfaces to Tailwind can happen incrementally.
//
// Two important calls:
//
//   1. corePlugins.preflight = false — Tailwind's "preflight" CSS reset
//      would aggressively reset buttons / lists / etc. That'd clobber
//      everything we already have inline-styled. Utilities still work;
//      we just skip the reset.
//
//   2. theme.extend.colors — bound to CSS variables from globals.css so
//      `bg-surface`, `text-ink`, `border-line`, etc. follow the active
//      light/dark theme without needing Tailwind's own dark-mode flag.
//      The body[data-theme="dark"] selector in globals.css already
//      flips the var values; Tailwind utilities just read them.
//
export default {
  content: [
    './src/renderer/index.html',
    './src/renderer/**/*.{js,jsx,ts,tsx}',
  ],
  // Mirror our globals.css `body[data-theme="dark"]` switch so any
  // explicit `dark:` utility variants resolve correctly.
  darkMode: ['selector', 'body[data-theme="dark"]'],
  corePlugins: {
    preflight: false,
  },
  theme: {
    extend: {
      colors: {
        // Surfaces
        bg:         'var(--bg)',
        surface:    'var(--surface)',
        'surface-2':'var(--surface-2)',
        'surface-3':'var(--surface-3)',

        // Inks (text)
        ink:        'var(--ink)',
        'ink-2':    'var(--ink-2)',
        'ink-3':    'var(--ink-3)',
        'ink-4':    'var(--ink-4)',
        'ink-5':    'var(--ink-5)',

        // Lines
        line:       'var(--line)',
        'line-2':   'var(--line-2)',

        // Accent
        accent:     'var(--accent)',
        'accent-2': 'var(--accent-2)',
        'accent-3': 'var(--accent-3)',
        'accent-bg':'var(--accent-bg)',

        // Status
        danger:     'var(--danger)',
        'danger-bg':'var(--danger-bg)',
        'danger-border':'var(--danger-border)',
        'danger-text':'var(--danger-text)',
        warning:    'var(--warning)',
        'warning-bg':'var(--warning-bg)',
        'warning-border':'var(--warning-border)',
        'warning-text':'var(--warning-text)',
        'info-bg':  'var(--info-bg)',
        'info-border':'var(--info-border)',
        'info-text':'var(--info-text)',
        success:    '#1F8F5F',
        'success-bg':'var(--success-bg)',
        'success-border':'var(--success-border)',
        'success-text':'var(--success-text)',

        // Aliases for mdb-ai's class names so a verbatim port works.
        // mdb-ai uses text-text-primary, bg-surface-01, border-border-02.
        // Map these to our nearest tokens.
        'text-primary': 'var(--ink)',
        'text-secondary':'var(--ink-2)',
        'text-faint':   'var(--ink-4)',
        'surface-01':   'var(--surface)',
        'surface-01-hover': 'var(--surface-2)',
        'surface-02':   'var(--surface-2)',
        'border-01':    'var(--line)',
        'border-02':    'var(--line-2)',
      },
      fontFamily: {
        body:    ['Inter', 'system-ui', 'sans-serif'],
        display: ['"Josefin Sans"', 'sans-serif'],
        mono:    ['"JetBrains Mono"', 'monospace'],
      },
      fontSize: {
        // Design-system type scale (from globals.css tokens)
        '2xs':  'var(--text-2xs)',
        'xs':   'var(--text-xs)',
        'sm':   'var(--text-sm)',
        'base': 'var(--text-base)',
        'md':   'var(--text-md)',
        'lg':   'var(--text-lg)',
        'xl':   'var(--text-xl)',
        '2xl':  'var(--text-2xl)',
        '3xl':  'var(--text-3xl)',
        // mdb-ai uses text-detail, text-body, text-small. Map to px sizes
        // close to ours so the ports don't look out of place.
        detail: ['11px',   { lineHeight: '1.4' }],
        body:   ['14.5px', { lineHeight: '1.55' }],
        small:  ['12.5px', { lineHeight: '1.4' }],
      },
      spacing: {
        '1':  'var(--space-1)',
        '2':  'var(--space-2)',
        '3':  'var(--space-3)',
        '4':  'var(--space-4)',
        '5':  'var(--space-5)',
        '6':  'var(--space-6)',
        '8':  'var(--space-8)',
        '10': 'var(--space-10)',
        '12': 'var(--space-12)',
      },
    },
  },
  plugins: [],
};
