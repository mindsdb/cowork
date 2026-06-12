// CHOOSE YOUR DISPLAY — theme picker, shown right after the coworker
// cartridge is chosen and before POWER UP.
//
// Four preset "monitors", each a miniature render of the app in that
// palette: MIDNIGHT (normal dark), DAYLIGHT (normal light), GAME BOY
// (8-bit light), ARCADE (8-bit dark). One pick sets both axes
// (skin + light/dark). A footer points at Settings → Appearance, where
// the user can mix the axes freely or design their own Custom theme —
// deliberately NOT on this screen, to keep onboarding one decision.

import { useEffect, useRef, useState } from 'react';
import { ArcadeShell, PressPrompt } from './components';

export interface ThemePreset {
  id: string;
  name: string;
  sub: string;
  desc: string;
  skin: 'normal' | '8bit';
  theme: 'light' | 'dark';
  /** Card accent + preview palette. */
  color: string;
  p: { bg: string; side: string; ink: string; muted: string; accent: string; line: string };
  scanlines: boolean;
}

// Order = the slots on screen: the standard looks lead (dark first,
// matching the CRT chooser itself), the 8-bit skins follow, and the
// CREATE YOUR OWN card below always sits last.
export const THEME_PRESETS: ThemePreset[] = [
  {
    id: 'midnight',
    name: 'MIDNIGHT',
    sub: 'STANDARD · DARK',
    desc: 'The standard look on deep-night surfaces with a neon cyan accent.',
    skin: 'normal', theme: 'dark',
    color: '#c4b5fd',
    p: { bg: '#080d18', side: '#0E1626', ink: '#F2F6FF', muted: '#8A97AE', accent: '#22D3EE', line: '#2A3957' },
    scanlines: false,
  },
  {
    id: 'daylight',
    name: 'DAYLIGHT',
    sub: 'STANDARD · LIGHT',
    desc: 'The standard look on clean white surfaces with a teal accent.',
    skin: 'normal', theme: 'light',
    color: '#fbbf24',
    p: { bg: '#FAFAFA', side: '#ECECEA', ink: '#0E0F10', muted: '#6B6F73', accent: '#1F9CB0', line: '#E4E4E1' },
    scanlines: false,
  },
  {
    id: 'gameboy',
    name: 'GAME BOY',
    sub: '8-BIT · LIGHT',
    desc: 'Olive paper and deep-green ink, mono type. Handheld nostalgia for bright rooms.',
    skin: '8bit', theme: 'light',
    color: '#4ade80',
    p: { bg: '#e8ead8', side: '#e2e5cd', ink: '#232b1e', muted: '#5f6b4e', accent: '#2e7d4f', line: '#c2c7a4' },
    scanlines: true,
  },
  {
    id: 'arcade',
    name: 'ARCADE',
    sub: '8-BIT · DARK',
    desc: 'Phosphor cyan on deep navy, CRT scanlines, chunky mono type. The coin-op classic.',
    skin: '8bit', theme: 'dark',
    color: '#3dd6f5',
    p: { bg: '#0a0a13', side: '#10101a', ink: '#ecedf6', muted: '#8d8fa8', accent: '#3dd6f5', line: '#2e2e44' },
    scanlines: true,
  },
];

// The 5th card — not a preset: it advertises the in-app Custom designer
// (Settings → Appearance → Style → Custom). Focusable so the detail
// panel can explain it, but not pickable from this screen.
const CUSTOM_SLOT = {
  id: 'custom-slot',
  name: 'CREATE YOUR OWN',
  sub: 'CUSTOM',
  desc: 'Design your own theme inside the app — accent, background, corners, type and scanlines. Settings → Appearance → Style → Custom.',
  color: '#a78bfa',
};

/** Mini "designer" visual for the CREATE YOUR OWN card: paint swatches. */
function MiniDesigner({ height = 64 }: { height?: number }) {
  const swatches = ['#3dd6f5', '#4ade80', '#fbbf24', '#f87168', '#a78bfa', '#f472b6'];
  return (
    <div style={{ position: 'relative', height, borderRadius: 3, display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 7, background: 'var(--arc-bg-2)', border: '1px dashed var(--arc-edge-2)', padding: '0 12%' }} aria-hidden>
      <div style={{ display: 'flex', gap: 5 }}>
        {swatches.map((c) => (
          <span key={c} style={{ width: 11, height: 11, background: c, borderRadius: 1 }} />
        ))}
      </div>
      <div style={{ height: 4, width: '85%', background: 'var(--arc-edge-2)', borderRadius: 2, position: 'relative' }}>
        <span style={{ position: 'absolute', left: '58%', top: -3, width: 9, height: 10, background: 'var(--arc-muted)', borderRadius: 1 }} />
      </div>
      <div style={{ height: 4, width: '85%', background: 'var(--arc-edge-2)', borderRadius: 2, position: 'relative' }}>
        <span style={{ position: 'absolute', left: '26%', top: -3, width: 9, height: 10, background: 'var(--arc-muted)', borderRadius: 1 }} />
      </div>
    </div>
  );
}

/** Miniature app render: sidebar strip, heading, accent line, input box. */
function MiniApp({ preset, height = 64 }: { preset: ThemePreset; height?: number }) {
  const { p, skin } = preset;
  const r = skin === '8bit' ? 1 : 3;
  return (
    <div style={{ position: 'relative', height, borderRadius: 3, overflow: 'hidden', display: 'flex', background: p.bg, border: `1px solid ${p.line}` }} aria-hidden>
      {preset.scanlines && (
        <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none', background: 'repeating-linear-gradient(to bottom, rgba(0,0,0,0.14) 0px, rgba(0,0,0,0.14) 1px, transparent 1px, transparent 3px)' }} />
      )}
      <div style={{ width: '22%', background: p.side, padding: '8% 6%' }}>
        <div style={{ height: 5, background: p.accent, borderRadius: r }} />
        <div style={{ height: 3, width: '80%', background: p.muted, opacity: 0.55, marginTop: 6, borderRadius: r }} />
        <div style={{ height: 3, width: '70%', background: p.muted, opacity: 0.55, marginTop: 3, borderRadius: r }} />
      </div>
      <div style={{ flex: 1, padding: '7% 7%' }}>
        <div style={{ height: 6, width: '85%', background: p.ink, borderRadius: r }} />
        <div style={{ height: 4, width: '55%', background: p.muted, marginTop: 5, borderRadius: r }} />
        <div style={{ height: 14, marginTop: 8, border: `1px solid ${p.accent}`, borderRadius: r + 1 }} />
      </div>
    </div>
  );
}

export default function ThemeSelect({
  onSelect,
  onBack,
}: {
  onSelect: (preset: ThemePreset) => void;
  onBack?: () => void;
}) {
  // Slots 0..3 are the presets; the last slot is the CREATE YOUR OWN
  // card (focusable for its explainer, not pickable here).
  const SLOT_COUNT = THEME_PRESETS.length + 1;
  const customIdx = THEME_PRESETS.length;
  const [focus, setFocus] = useState(0);
  const isCustomSlot = focus === customIdx;
  const focused = isCustomSlot ? null : THEME_PRESETS[focus];
  const cardRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const focusRef = useRef(0);
  focusRef.current = focus;

  const moveFocus = (idx: number) => {
    focusRef.current = idx;
    setFocus(idx);
    cardRefs.current[idx]?.focus({ preventScroll: true });
  };

  useEffect(() => {
    cardRefs.current[focusRef.current]?.focus({ preventScroll: true });
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight' || e.key === 'ArrowDown') { e.preventDefault(); moveFocus((focusRef.current + 1) % SLOT_COUNT); }
      else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') { e.preventDefault(); moveFocus((focusRef.current - 1 + SLOT_COUNT) % SLOT_COUNT); }
      else if (e.key === 'Home') { e.preventDefault(); moveFocus(0); }
      else if (e.key === 'End') { e.preventDefault(); moveFocus(SLOT_COUNT - 1); }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Live-preview the focused preset: the whole chooser re-skins as you
  // browse (Game Boy card → Game Boy page, etc.). The CREATE YOUR OWN
  // slot has no preset, so fall back to the neutral arcade default.
  // ARCADE's id has no palette block — it IS the default — so setting
  // it is equivalent to clearing.
  useEffect(() => {
    const id = THEME_PRESETS[focus]?.id;
    if (id) document.body.dataset.arcadePreset = id;
    else delete document.body.dataset.arcadePreset;
  }, [focus]);

  return (
    <ArcadeShell title="CHOOSE YOUR DISPLAY" subtitle="pick your screen · change it anytime">
      <div className="arc-stack arc-fade-in" style={{ gap: 0, width: '100%' }}>
        <div className="arc-cart-row" role="radiogroup" aria-label="Choose your display theme">
          {THEME_PRESETS.map((tp, idx) => {
            const isFocused = idx === focus;
            return (
              <div className="arc-cart-wrap" key={tp.id}>
                {isFocused && (
                  <div className="arc-brackets" style={{ '--cart-color': tp.color } as React.CSSProperties}>
                    <span /><span /><span /><span />
                  </div>
                )}
                <button
                  type="button"
                  role="radio"
                  aria-checked={isFocused}
                  aria-label={`${tp.name} — ${tp.sub}`}
                  tabIndex={isFocused ? 0 : -1}
                  ref={(el) => { cardRefs.current[idx] = el; }}
                  className={`arc-cart${isFocused ? ' focused' : ''}`}
                  style={{ '--cart-color': tp.color, width: 168, padding: '16px 12px 14px', gap: 12 } as React.CSSProperties}
                  onClick={() => {
                    if (idx !== focus) { moveFocus(idx); return; }
                    onSelect(tp);
                  }}
                  onDoubleClick={() => onSelect(tp)}
                >
                  <div style={{ width: '100%' }}>
                    <MiniApp preset={tp} />
                  </div>
                  <span className="arc-cart-name" style={{ fontSize: 12 }}>{tp.name}</span>
                  <span style={{ fontSize: 9, letterSpacing: '0.12em', color: 'var(--arc-muted)', marginTop: -14 }}>{tp.sub}</span>
                </button>
              </div>
            );
          })}

          {/* CREATE YOUR OWN — explainer card for the in-app designer */}
          <div className="arc-cart-wrap" key={CUSTOM_SLOT.id}>
            {isCustomSlot && (
              <div className="arc-brackets" style={{ '--cart-color': CUSTOM_SLOT.color } as React.CSSProperties}>
                <span /><span /><span /><span />
              </div>
            )}
            <button
              type="button"
              role="radio"
              aria-checked={isCustomSlot}
              aria-label={`${CUSTOM_SLOT.name} — design your own theme inside the app`}
              tabIndex={isCustomSlot ? 0 : -1}
              ref={(el) => { cardRefs.current[customIdx] = el; }}
              className={`arc-cart${isCustomSlot ? ' focused' : ''}`}
              style={{ '--cart-color': CUSTOM_SLOT.color, width: 168, padding: '16px 12px 14px', gap: 12 } as React.CSSProperties}
              onClick={() => { if (customIdx !== focus) moveFocus(customIdx); }}
            >
              <div style={{ width: '100%' }}>
                <MiniDesigner />
              </div>
              <span className="arc-cart-name" style={{ fontSize: 12 }}>{CUSTOM_SLOT.name}</span>
              <span style={{ fontSize: 9, letterSpacing: '0.12em', color: 'var(--arc-muted)', marginTop: -14 }}>{CUSTOM_SLOT.sub}</span>
            </button>
          </div>
        </div>

        {/* Focused slot description */}
        <div
          className="arc-panel"
          key={focused ? focused.id : CUSTOM_SLOT.id}
          style={{ width: '100%', maxWidth: 760, boxSizing: 'border-box', marginTop: 24, padding: '14px 22px', display: 'flex', alignItems: 'center', gap: 16 }}
        >
          <span style={{ fontSize: 17, fontWeight: 700, letterSpacing: '0.10em', color: (focused ?? CUSTOM_SLOT).color, flex: 'none' }}>{(focused ?? CUSTOM_SLOT).name}</span>
          <span style={{ fontSize: 10.5, letterSpacing: '0.05em', lineHeight: 1.6, color: 'var(--arc-muted)', textAlign: 'left' }}>{(focused ?? CUSTOM_SLOT).desc}</span>
        </div>

        <div style={{ marginTop: 16, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}>
          <PressPrompt
            label={focused ? `PRESS ⏎ TO PICK ${focused.name}` : 'DESIGN IT INSIDE THE APP — PICK A PRESET TO START'}
            onPress={() => { if (focused) onSelect(focused); }}
            disabled={!focused}
          />
          {onBack && (
            <button
              type="button"
              className="arc-link"
              onClick={() => {
                // Leaving without picking — drop the live preview so the
                // coworker screen we return to shows the neutral CRT.
                delete document.body.dataset.arcadePreset;
                onBack();
              }}
              style={{ marginTop: 4 }}
            >
              ← back
            </button>
          )}
        </div>
      </div>
    </ArcadeShell>
  );
}
