/** @type {import('tailwindcss').Config} */
// Keep preflight disabled to preserve existing element styling.
// Colors read globals.css variables, which body[data-theme] switches for light/dark.
export default {
  content: [
    './src/renderer/index.html',
    './src/renderer/**/*.{js,jsx,ts,tsx}',
  ],
  // Match globals.css body[data-theme] for explicit dark variants.
  darkMode: ['selector', 'body[data-theme="dark"]'],
  corePlugins: {
    preflight: false,
  },
  theme: {
    extend: {
      colors: {
        bg:         'var(--bg)',
        surface:    'var(--surface)',
        'surface-2':'var(--surface-2)',
        'surface-3':'var(--surface-3)',

        ink:        'var(--ink)',
        'ink-2':    'var(--ink-2)',
        'ink-3':    'var(--ink-3)',
        'ink-4':    'var(--ink-4)',
        'ink-5':    'var(--ink-5)',

        line:       'var(--line)',
        'line-2':   'var(--line-2)',

        accent:     'var(--accent)',
        'accent-2': 'var(--accent-2)',
        'accent-3': 'var(--accent-3)',
        'accent-bg':'var(--accent-bg)',

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

        'surface-glass':'var(--surface-glass)',
        'sage-500':     'var(--sage-500)',

        // Map mdb-ai class names to existing theme tokens.
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
        display: ['Inter', 'system-ui', 'sans-serif'],
        mono:    ['"JetBrains Mono"', 'monospace'],
      },
      fontSize: {
        '2xs':  'var(--text-2xs)',
        'xs':   'var(--text-xs)',
        'sm':   'var(--text-sm)',
        'base': 'var(--text-base)',
        'md':   'var(--text-md)',
        'lg':   'var(--text-lg)',
        'xl':   'var(--text-xl)',
        '2xl':  'var(--text-2xl)',
        '3xl':  'var(--text-3xl)',
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
      // Use the same CSS variables as the legacy .card classes.
      borderRadius: {
        card:       'var(--card-radius)',
        'card-row': 'var(--card-radius-row)',
      },
      boxShadow: {
        'sh-1':       'var(--sh-1)',
        'sh-2':       'var(--sh-2)',
        'sh-3':       'var(--sh-3)',
        'sh-popup':   'var(--sh-popup)',
        card:         'var(--card-shadow-rest)',
        'card-hover': 'var(--card-shadow-hover)',
      },
      keyframes: {
        'scale-in':  { from: { opacity: 0, transform: 'scale(0.97)' }, to: { opacity: 1, transform: 'scale(1)' } },
        'scale-out': { from: { opacity: 1, transform: 'scale(1)' },    to: { opacity: 0, transform: 'scale(0.97)' } },
        'chip-in':   { from: { opacity: 0, transform: 'scale(0.95)' }, to: { opacity: 1, transform: 'scale(1)' } },
        // Use opacity only inside an open popup so content changes do not animate its geometry
        // again.
        'fade-in':   { from: { opacity: 0 }, to: { opacity: 1 } },
        'fade-out':  { from: { opacity: 1 }, to: { opacity: 0 } },
      },
      animation: {
        'scale-in':  'scale-in 130ms ease-out',
        'scale-out': 'scale-out 90ms ease-in',
        'chip-in':   'chip-in 180ms cubic-bezier(0.23, 1, 0.32, 1) both',
        'fade-in':   'fade-in 160ms ease-out',
        // `forwards` holds opacity at 0 between the animation's end and the
        // moment the exiting element is actually unmounted.
        'fade-out':  'fade-out 320ms ease-in forwards',
      },
    },
  },
  plugins: [],
};
