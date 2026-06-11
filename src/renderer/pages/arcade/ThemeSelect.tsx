// CHOOSE YOUR DISPLAY — theme picker, shown right after the coworker
// cartridge is chosen and before POWER UP.
//
// Four preset "monitors" (ARCADE / GAME BOY / MIDNIGHT / DAYLIGHT), each
// a miniature render of the app in that palette — one pick sets both
// axes (skin + light/dark). During World Cup 2026 a seasonal 🏆 card
// sits at position 4 and opens the team-select overlay. The final card
// advertises the in-app Custom designer (Settings → Appearance) —
// focusable for its explainer, not pickable here.

import { useEffect, useRef, useState } from 'react';
import { ArcadeShell, PressPrompt } from './components';
import { WORLD_CUP_2026, WORLD_CUP_TEAMS, type WorldCupTeam } from '../../lib/worldcup';
import WorldCupOverlay from './WorldCupOverlay';

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

export const THEME_PRESETS: ThemePreset[] = [
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
];

// Non-preset cards. WORLD CUP is SEASONAL (gated by WORLD_CUP_2026 —
// see lib/worldcup.ts for the removal plan); CUSTOM is the permanent
// pointer at the in-app designer.
const WORLDCUP_SLOT = {
  id: 'worldcup-slot',
  name: 'WORLD CUP',
  sub: '2026 · 48 NATIONS',
  desc: 'Wear your team’s colours — pick from all 48 qualified nations. A limited-time kit: here for the tournament, gone after the final.',
  color: '#fbbf24',
};

const CUSTOM_SLOT = {
  id: 'custom-slot',
  name: 'CREATE YOUR OWN',
  sub: 'CUSTOM',
  desc: 'Design your own theme inside the app — accent, background, corners, type and scanlines. Settings → Appearance → Style → Custom.',
  color: '#a78bfa',
};

type Slot =
  | { kind: 'preset'; preset: ThemePreset }
  | { kind: 'worldcup' }
  | { kind: 'custom' };

// Card order: three presets, the seasonal World Cup slot at position 4,
// DAYLIGHT, then CREATE YOUR OWN.
const SLOTS: Slot[] = [
  ...THEME_PRESETS.slice(0, 3).map((preset) => ({ kind: 'preset' as const, preset })),
  ...(WORLD_CUP_2026 ? [{ kind: 'worldcup' as const }] : []),
  ...THEME_PRESETS.slice(3).map((preset) => ({ kind: 'preset' as const, preset })),
  { kind: 'custom' as const },
];

function slotMeta(slot: Slot) {
  if (slot.kind === 'preset') return slot.preset;
  return slot.kind === 'worldcup' ? WORLDCUP_SLOT : CUSTOM_SLOT;
}

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

/** Mini terrace of team flags for the WORLD CUP card. */
function MiniFlagWall({ height = 64 }: { height?: number }) {
  const featured = ['england', 'brazil', 'france', 'mexico', 'japan', 'morocco']
    .map((id) => WORLD_CUP_TEAMS.find((t) => t.id === id))
    .filter((t): t is WorldCupTeam => Boolean(t));
  return (
    <div style={{ position: 'relative', height, borderRadius: 3, display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 5, alignContent: 'center', background: 'var(--arc-bg-2)', border: '1px solid var(--arc-edge-2)', padding: '0 10%' }} aria-hidden>
      {featured.map((t) => (
        <span key={t.id} style={{ display: 'flex', flexDirection: t.flagDir === 'h' ? 'column' : 'row', height: 16, borderRadius: 1, overflow: 'hidden', border: '1px solid var(--arc-edge)' }}>
          {t.flag.map((c, i) => (
            <span key={i} style={{ flex: 1, background: c }} />
          ))}
        </span>
      ))}
    </div>
  );
}

export default function ThemeSelect({
  onSelect,
  onWorldCup,
  onBack,
}: {
  onSelect: (preset: ThemePreset) => void;
  /** SEASONAL — picks a World Cup team theme (see lib/worldcup.ts). */
  onWorldCup?: (team: WorldCupTeam) => void;
  onBack?: () => void;
}) {
  const [focus, setFocus] = useState(0);
  const [showWorldCup, setShowWorldCup] = useState(false);
  const slot = SLOTS[focus];
  const meta = slotMeta(slot);
  const cardRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const focusRef = useRef(0);
  focusRef.current = focus;
  const overlayOpenRef = useRef(false);
  overlayOpenRef.current = showWorldCup;

  const moveFocus = (idx: number) => {
    focusRef.current = idx;
    setFocus(idx);
    cardRefs.current[idx]?.focus({ preventScroll: true });
  };

  const confirm = (idx: number) => {
    const s = SLOTS[idx];
    if (s.kind === 'preset') onSelect(s.preset);
    else if (s.kind === 'worldcup') setShowWorldCup(true);
    // custom: explainer only — nothing to confirm here
  };

  useEffect(() => {
    cardRefs.current[focusRef.current]?.focus({ preventScroll: true });
    const handler = (e: KeyboardEvent) => {
      if (overlayOpenRef.current) return; // the overlay owns the keyboard
      const len = SLOTS.length;
      if (e.key === 'ArrowRight' || e.key === 'ArrowDown') { e.preventDefault(); moveFocus((focusRef.current + 1) % len); }
      else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') { e.preventDefault(); moveFocus((focusRef.current - 1 + len) % len); }
      else if (e.key === 'Home') { e.preventDefault(); moveFocus(0); }
      else if (e.key === 'End') { e.preventDefault(); moveFocus(len - 1); }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Live-preview the focused preset: the whole chooser re-skins as you
  // browse (Game Boy card → Game Boy page, etc.). Non-preset slots
  // (World Cup, Create Your Own) fall back to the neutral arcade look.
  useEffect(() => {
    const s = SLOTS[focus];
    if (s?.kind === 'preset') document.body.dataset.arcadePreset = s.preset.id;
    else delete document.body.dataset.arcadePreset;
  }, [focus]);

  const pressLabel =
    slot.kind === 'preset' ? `PRESS ⏎ TO PICK ${meta.name}`
    : slot.kind === 'worldcup' ? 'PRESS ⏎ TO PICK YOUR TEAM'
    : 'DESIGN IT INSIDE THE APP — PICK A PRESET TO START';

  return (
    <ArcadeShell title="CHOOSE YOUR DISPLAY" subtitle="pick your screen · change it anytime">
      <div className="arc-stack arc-fade-in" style={{ gap: 0, width: '100%' }}>
        <div className="arc-cart-row" role="radiogroup" aria-label="Choose your display theme">
          {SLOTS.map((s, idx) => {
            const m = slotMeta(s);
            const isFocused = idx === focus;
            const ariaLabel =
              s.kind === 'preset' ? `${m.name} — ${m.sub}`
              : s.kind === 'worldcup' ? `${m.name} — pick a 2026 team theme`
              : `${m.name} — design your own theme inside the app`;
            return (
              <div className="arc-cart-wrap" key={m.id}>
                {isFocused && (
                  <div className="arc-brackets" style={{ '--cart-color': m.color } as React.CSSProperties}>
                    <span /><span /><span /><span />
                  </div>
                )}
                <button
                  type="button"
                  role="radio"
                  aria-checked={isFocused}
                  aria-label={ariaLabel}
                  tabIndex={isFocused ? 0 : -1}
                  ref={(el) => { cardRefs.current[idx] = el; }}
                  className={`arc-cart${isFocused ? ' focused' : ''}`}
                  style={{ '--cart-color': m.color, width: 168, padding: '16px 12px 14px', gap: 12 } as React.CSSProperties}
                  onClick={() => {
                    if (idx !== focus) { moveFocus(idx); return; }
                    confirm(idx);
                  }}
                  onDoubleClick={() => confirm(idx)}
                >
                  <div style={{ width: '100%' }}>
                    {s.kind === 'preset' ? <MiniApp preset={s.preset} />
                      : s.kind === 'worldcup' ? <MiniFlagWall />
                      : <MiniDesigner />}
                  </div>
                  <span className="arc-cart-name" style={{ fontSize: 12 }}>{m.name}</span>
                  <span style={{ fontSize: 9, letterSpacing: '0.12em', color: 'var(--arc-muted)', marginTop: -14 }}>{m.sub}</span>
                </button>
              </div>
            );
          })}
        </div>

        {/* Focused slot description */}
        <div
          className="arc-panel"
          key={meta.id}
          style={{ width: '100%', maxWidth: 760, boxSizing: 'border-box', marginTop: 24, padding: '14px 22px', display: 'flex', alignItems: 'center', gap: 16 }}
        >
          <span style={{ fontSize: 17, fontWeight: 700, letterSpacing: '0.10em', color: meta.color, flex: 'none' }}>{meta.name}</span>
          <span style={{ fontSize: 10.5, letterSpacing: '0.05em', lineHeight: 1.6, color: 'var(--arc-muted)', textAlign: 'left' }}>{meta.desc}</span>
        </div>

        <div style={{ marginTop: 16, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}>
          <PressPrompt
            label={pressLabel}
            onPress={() => confirm(focus)}
            disabled={slot.kind === 'custom' || showWorldCup}
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

      {showWorldCup && (
        <WorldCupOverlay
          onPick={(team) => { setShowWorldCup(false); onWorldCup?.(team); }}
          onClose={() => setShowWorldCup(false)}
        />
      )}
    </ArcadeShell>
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
