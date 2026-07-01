// SELECT YOUR COWORKER — the cartridge-select screen.
//
// Same app · the agent is a cartridge. Anton and Hermes are the two
// real harnesses today (settings key `harness`); OpenClaw and ??? are
// visible-but-locked cartridges that telegraph the roadmap. Arrow keys
// or click to browse, Enter to confirm. The choice is handed up to the
// onboarding flow, which persists it alongside the provider settings.

import { useEffect, useRef, useState } from 'react';
import { ArcadeShell, PressPrompt, StatBar } from './components';
import { PixelSprite, type SpriteName } from './sprites';

export interface Coworker {
  id: string;            // harness id ('anton' | 'hermes') for unlocked carts
  name: string;
  tagline: string;
  special: string;
  sprite: SpriteName;
  color: string;
  locked: boolean;
  lockNote?: string;
  stats: { memory: number; artifacts: number; autonomy: number } | null;
}

// Each cartridge's colour is a concrete hex (single source of truth):
// it feeds both the `--cart-color` CSS custom property — `var()` resolves
// a hex fine — and StatBar's box-shadow string, which can't resolve a
// var() at all. Keep these in step with the --arc-* palette in arcade.css.
export const COWORKERS: Coworker[] = [
  {
    id: 'anton',
    name: 'ANTON',
    tagline: 'The full-stack workhorse',
    special: 'SPECIAL: DEEP WORK — plans, codes, and remembers everything.',
    sprite: 'anton',
    color: '#4ade80',
    locked: false,
    stats: { memory: 4, artifacts: 5, autonomy: 4 },
  },
  {
    id: 'hermes',
    name: 'HERMES',
    tagline: 'The swift messenger',
    special: 'SPECIAL: LIGHTNING TOOLS — independent tools and memory system.',
    sprite: 'hermes',
    color: '#fbbf24',
    locked: false,
    stats: { memory: 3, artifacts: 4, autonomy: 4 },
  },
  {
    id: 'openclaw',
    name: 'OPENCLAW',
    tagline: 'The open automator',
    special: 'SPECIAL: WIDE GRIP — automation across every surface.',
    sprite: 'openclaw',
    color: '#f87168',
    locked: true,
    lockNote: 'COMING SOON',
    stats: { memory: 4, artifacts: 4, autonomy: 5 },
  },
  {
    id: 'mystery',
    name: '???',
    tagline: 'Data expunged',
    special: 'SPECIAL: ████████ — █████ ███ ████████.',
    sprite: 'mystery',
    color: '#a78bfa',
    locked: true,
    lockNote: 'TOP SECRET',
    stats: null,
  },
];

export default function CoworkerSelect({
  onSelect,
  onBack,
}: {
  onSelect: (harnessId: string, label: string) => void;
  /** Optional — when present, a "back" affordance returns to the prior step. */
  onBack?: () => void;
}) {
  const [focus, setFocus] = useState(0);
  const [shakeIdx, setShakeIdx] = useState<number | null>(null);
  const [lockMsg, setLockMsg] = useState('');
  const focused = COWORKERS[focus];
  const shakeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Roving-tabindex focus: one button is tabbable at a time; arrow keys
  // move DOM focus between cards so screen readers track the selection.
  const cardRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const focusRef = useRef(0);
  focusRef.current = focus;

  const confirm = (idx: number) => {
    const cw = COWORKERS[idx];
    if (cw.locked) {
      setShakeIdx(idx);
      setLockMsg(cw.lockNote === 'TOP SECRET'
        ? 'THIS CARTRIDGE IS CLASSIFIED.'
        : 'THIS CARTRIDGE ISN’T OUT YET — PICK ANOTHER COWORKER.');
      if (shakeTimer.current) clearTimeout(shakeTimer.current);
      shakeTimer.current = setTimeout(() => setShakeIdx(null), 350);
      return;
    }
    onSelect(cw.id, cw.name);
  };

  const moveFocus = (idx: number) => {
    focusRef.current = idx; // sync now so rapid key presses don't read a stale index
    setFocus(idx);
    setLockMsg('');
    cardRefs.current[idx]?.focus({ preventScroll: true });
  };

  useEffect(() => {
    // Land keyboard focus inside the radiogroup on mount so arrow keys
    // work immediately and the game-select reads as focusable.
    cardRefs.current[focusRef.current]?.focus({ preventScroll: true });
    const handler = (e: KeyboardEvent) => {
      const len = COWORKERS.length;
      if (e.key === 'ArrowRight' || e.key === 'ArrowDown') { e.preventDefault(); moveFocus((focusRef.current + 1) % len); }
      else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') { e.preventDefault(); moveFocus((focusRef.current - 1 + len) % len); }
      else if (e.key === 'Home') { e.preventDefault(); moveFocus(0); }
      else if (e.key === 'End') { e.preventDefault(); moveFocus(len - 1); }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => () => { if (shakeTimer.current) clearTimeout(shakeTimer.current); }, []);

  return (
    <ArcadeShell title="SELECT YOUR COWORKER" subtitle="same app · the agent is a cartridge">
      <div className="arc-stack arc-fade-in" style={{ gap: 0, width: '100%' }}>
        <div className="arc-cart-row" role="radiogroup" aria-label="Select your coworker">
          {COWORKERS.map((cw, idx) => {
            const isFocused = idx === focus;
            return (
              <div className="arc-cart-wrap" key={cw.id}>
                {isFocused && (
                  <div className="arc-brackets" style={{ '--cart-color': cw.color } as React.CSSProperties}>
                    <span /><span /><span /><span />
                  </div>
                )}
                <button
                  type="button"
                  role="radio"
                  aria-checked={isFocused}
                  aria-label={cw.locked ? `${cw.name} — locked, ${cw.lockNote}` : `${cw.name} — ${cw.tagline}`}
                  tabIndex={isFocused ? 0 : -1}
                  ref={(el) => { cardRefs.current[idx] = el; }}
                  className={`arc-cart${isFocused ? ' focused' : ''}${cw.locked ? ' locked' : ''}${shakeIdx === idx ? ' shake' : ''}`}
                  style={{ '--cart-color': cw.color } as React.CSSProperties}
                  onClick={() => {
                    if (idx !== focus) { setFocus(idx); setLockMsg(''); return; }
                    confirm(idx);
                  }}
                  onDoubleClick={() => confirm(idx)}
                >
                  {cw.locked && <span className="arc-cart-lock">▣ {cw.lockNote}</span>}
                  <PixelSprite name={cw.sprite} size={84} bob={isFocused} title={cw.name} />
                  <span className="arc-cart-name">{cw.name}</span>
                </button>
              </div>
            );
          })}
        </div>

        {/* Detail panel for the focused cartridge */}
        <div
          className="arc-panel arc-cart-detail"
          style={{ '--cart-color': focused.color } as React.CSSProperties}
          key={focused.id}
        >
          <div style={{ textAlign: 'left', minWidth: 0 }}>
            <div className="arc-cart-detail-name">{focused.name}</div>
            <div className="arc-cart-detail-tag">{focused.tagline}</div>
            <div style={{ marginTop: 10, fontSize: 10.5, letterSpacing: '0.06em', lineHeight: 1.6, color: 'var(--arc-muted)' }}>
              {focused.special}
            </div>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 9, flex: 'none' }}>
            <StatBar label="MEMORY" value={focused.stats?.memory ?? 0} color={focused.color} unknown={!focused.stats} />
            <StatBar label="ARTIFACTS" value={focused.stats?.artifacts ?? 0} color={focused.color} unknown={!focused.stats} />
            <StatBar label="AUTONOMY" value={focused.stats?.autonomy ?? 0} color={focused.color} unknown={!focused.stats} />
          </div>
        </div>

        {lockMsg && (
          <div className="arc-error" role="alert" style={{ maxWidth: 640, marginTop: 18, justifyContent: 'center' }}>
            <span style={{ fontWeight: 700 }}>▣</span>
            <span>{lockMsg}</span>
          </div>
        )}
        <div style={{ marginTop: lockMsg ? 8 : 18, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
          <PressPrompt
            label={focused.locked ? 'LOCKED — PICK ANOTHER' : `PRESS ⏎ TO HIRE ${focused.name}`}
            onPress={() => confirm(focus)}
            disabled={focused.locked}
          />
          <div style={{ fontSize: 10, letterSpacing: '0.1em', color: 'var(--arc-muted)' }}>
            <span className="arc-kbd">◀</span> <span className="arc-kbd">▶</span> browse &nbsp;·&nbsp; you can switch coworkers anytime in Settings
          </div>
          {onBack && (
            <button type="button" className="arc-link" onClick={onBack} style={{ marginTop: 4 }}>
              ← back
            </button>
          )}
        </div>
      </div>
    </ArcadeShell>
  );
}
