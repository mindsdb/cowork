// Welcome loading view and onboarding look, shared by App's loading page and
// the web entry's Keycloak init gate so a reload never paints an empty page.

import OrbitMorph from './cowork/components/ui/OrbitMorph';

/**
 * Map skin + theme to the onboarding shell's look. arcade.css reads
 * body[data-arcade-preset]: 'midnight'/'daylight' = clean (Inter, no CRT),
 * 'gameboy' = 8-bit light, default (no preset) = 8-bit dark CRT.
 * Reads the theme from body[data-theme] and writes the preset attribute.
 */
export function applyArcadePreset(skin: string): void {
  const theme = document.body.dataset.theme === 'light' ? 'light' : 'dark';
  const preset = skin === '8bit'
    ? (theme === 'light' ? 'gameboy' : null)         // null → default arcade dark
    : (theme === 'light' ? 'daylight' : 'midnight'); // clean / "normal"
  if (preset) document.body.dataset.arcadePreset = preset;
  else delete document.body.dataset.arcadePreset;
}

/** The welcome orb and title, with an optional boot status line under them. */
export function WelcomeLoading({ status }: { status?: string | null }) {
  return (
    <div
      className="arc-root welcome-loading"
      style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 20 }}
    >
      <OrbitMorph state="thinking" size={72} />
      <div className="arc-welcome-title">
        Welcome to MindsHub Cowork
      </div>
      {status && (
        <div style={{ fontSize: 13, lineHeight: 1.6, color: 'var(--arc-muted)' }}>
          {status}
        </div>
      )}
    </div>
  );
}
