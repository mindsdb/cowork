// WORLD CUP 2026 — stadium flag wall (SEASONAL, see lib/worldcup.ts for
// the removal plan).
//
// A dedicated overlay opened from the CHOOSE YOUR DISPLAY chooser: all
// 48 qualified nations as 8-bit flag tiles. Browsing live-retints the
// whole overlay to the focused team's kit (the same delight as the
// chooser's preset preview); Enter picks, Escape returns to the chooser.

import { useEffect, useMemo, useRef, useState } from 'react';
import { WORLD_CUP_TEAMS, teamRecipe, type WorldCupTeam } from '../../lib/worldcup';
import { hexMix, hexLuminance } from '../../lib/customTheme';

const COLS = 8;

function FlagTile({ team, size = 1 }: { team: WorldCupTeam; size?: number }) {
  const stripes = team.flag.map((c, i) => (
    <span key={i} style={{ flex: 1, background: c }} />
  ));
  return (
    <span
      aria-hidden
      style={{
        display: 'flex',
        flexDirection: team.flagDir === 'h' ? 'column' : 'row',
        width: '100%',
        height: 30 * size,
        borderRadius: 2,
        overflow: 'hidden',
      }}
    >
      {stripes}
    </span>
  );
}

export default function WorldCupOverlay({
  onPick,
  onClose,
}: {
  onPick: (team: WorldCupTeam) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState('');
  const [focus, setFocus] = useState(0);
  const tileRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const focusRef = useRef(0);
  focusRef.current = focus;

  const teams = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return WORLD_CUP_TEAMS;
    return WORLD_CUP_TEAMS.filter((t) => t.name.toLowerCase().includes(q) || t.conf.toLowerCase().includes(q));
  }, [query]);
  const teamsRef = useRef(teams);
  teamsRef.current = teams;

  // Clamp focus when the filter shrinks the list.
  const safeFocus = Math.min(focus, Math.max(0, teams.length - 1));
  const focused: WorldCupTeam | undefined = teams[safeFocus];

  const moveFocus = (idx: number) => {
    const len = teamsRef.current.length;
    if (!len) return;
    const next = ((idx % len) + len) % len;
    focusRef.current = next;
    setFocus(next);
    tileRefs.current[next]?.focus({ preventScroll: false });
  };

  // Land keyboard focus on the first flag so arrows/Enter work
  // immediately (and the chooser's PressPrompt ignores Enter, since the
  // event target is a button inside this dialog).
  useEffect(() => {
    tileRefs.current[0]?.focus({ preventScroll: true });
  }, []);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); onClose(); return; }
      const len = teamsRef.current.length;
      if (!len) return;
      if (e.key === 'ArrowRight') { e.preventDefault(); moveFocus(focusRef.current + 1); }
      else if (e.key === 'ArrowLeft') { e.preventDefault(); moveFocus(focusRef.current - 1); }
      else if (e.key === 'ArrowDown') { e.preventDefault(); moveFocus(focusRef.current + COLS); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); moveFocus(focusRef.current - COLS); }
      else if (e.key === 'Home') { e.preventDefault(); moveFocus(0); }
      else if (e.key === 'End') { e.preventDefault(); moveFocus(len - 1); }
      else if (e.key === 'Enter') {
        // Only when the search field isn't the target — Enter there picks
        // the first match instead, which is also what we do here since
        // focus tracks the filtered list.
        e.preventDefault();
        const t = teamsRef.current[focusRef.current];
        if (t) onPick(t);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Live kit tinting ───────────────────────────────────────────────
  // Use the SAME readable surface the app will get (teamRecipe), so the
  // picker previews exactly what you'll land in.
  const bg = (focused ? teamRecipe(focused).bg : null) ?? '#0a0a13';
  const accent = focused?.accent ?? '#3dd6f5';
  const dark = hexLuminance(bg) < 0.5;
  const ink = dark ? '#f2f4f8' : '#181a20';
  const muted = hexMix(ink, bg, 0.42);
  const dim = hexMix(ink, bg, 0.6);
  const panel = hexMix(bg, dark ? '#ffffff' : '#000000', 0.05);
  const edge = hexMix(bg, dark ? '#ffffff' : '#000000', 0.16);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="World Cup 2026 — pick your team"
      style={{
        position: 'fixed', inset: 0, zIndex: 1500,
        display: 'flex', flexDirection: 'column',
        background: bg, color: ink,
        fontFamily: "'JetBrains Mono', 'SF Mono', ui-monospace, Menlo, monospace",
        transition: 'background 200ms ease',
        overflow: 'hidden',
      }}
    >
      {/* CRT scanlines — kept very subtle so the flags read cleanly. */}
      <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 50, background: `repeating-linear-gradient(to bottom, ${dark ? 'rgba(0,0,0,0.035)' : 'rgba(0,0,0,0.025)'} 0px, ${dark ? 'rgba(0,0,0,0.035)' : 'rgba(0,0,0,0.025)'} 1px, transparent 1px, transparent 4px)` }} />

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '18px 24px 0', position: 'relative', zIndex: 1 }}>
        <button
          type="button"
          onClick={onClose}
          style={{ background: 'transparent', border: 0, padding: 0, fontFamily: 'inherit', fontSize: 11, color: muted, cursor: 'pointer', textDecoration: 'underline', textUnderlineOffset: 3 }}
        >ESC ← back</button>
        <div style={{ textAlign: 'center', flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 22, fontWeight: 700, letterSpacing: '0.2em', textIndent: '0.2em' }}>PICK YOUR TEAM</div>
          <div style={{ marginTop: 5, fontSize: 11, letterSpacing: '0.1em', color: muted }}>&mdash; world cup 2026 · 48 nations &mdash;</div>
        </div>
        <input
          type="text"
          placeholder="search…"
          value={query}
          onChange={(e) => { setQuery(e.target.value); setFocus(0); focusRef.current = 0; }}
          aria-label="Search teams"
          style={{ width: 130, background: panel, border: `1px solid ${edge}`, borderRadius: 4, color: ink, fontFamily: 'inherit', fontSize: 11, padding: '7px 10px', outline: 'none' }}
        />
      </div>

      <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '22px 32px', position: 'relative', zIndex: 1 }}>
        {teams.length === 0 ? (
          <div style={{ textAlign: 'center', marginTop: 60, fontSize: 12, letterSpacing: '0.08em', color: muted }}>
            NO TEAMS MATCH — the group stage was brutal
          </div>
        ) : (
          <div role="radiogroup" aria-label="Teams" style={{ display: 'grid', gridTemplateColumns: `repeat(${COLS}, 1fr)`, gap: 14, maxWidth: 860, margin: '0 auto' }}>
            {teams.map((t, idx) => {
              const isFocused = idx === safeFocus;
              return (
                <button
                  key={t.id}
                  type="button"
                  role="radio"
                  aria-checked={isFocused}
                  aria-label={`${t.name} — ${t.conf}`}
                  tabIndex={isFocused ? 0 : -1}
                  ref={(el) => { tileRefs.current[idx] = el; }}
                  onClick={() => {
                    if (idx !== safeFocus) { moveFocus(idx); return; }
                    onPick(t);
                  }}
                  onDoubleClick={() => onPick(t)}
                  style={{
                    position: 'relative',
                    background: 'transparent',
                    border: 0,
                    padding: 0,
                    cursor: 'pointer',
                    outline: 'none',
                    transform: isFocused ? 'scale(1.22)' : 'scale(1)',
                    transition: 'transform 100ms steps(2)',
                    zIndex: isFocused ? 2 : 1,
                  }}
                >
                  {isFocused && (
                    <span aria-hidden style={{ position: 'absolute', inset: -7, pointerEvents: 'none', color: accent }}>
                      <span style={{ position: 'absolute', top: 0, left: 0, width: 9, height: 9, borderTop: '3px solid currentColor', borderLeft: '3px solid currentColor' }} />
                      <span style={{ position: 'absolute', top: 0, right: 0, width: 9, height: 9, borderTop: '3px solid currentColor', borderRight: '3px solid currentColor' }} />
                      <span style={{ position: 'absolute', bottom: 0, left: 0, width: 9, height: 9, borderBottom: '3px solid currentColor', borderLeft: '3px solid currentColor' }} />
                      <span style={{ position: 'absolute', bottom: 0, right: 0, width: 9, height: 9, borderBottom: '3px solid currentColor', borderRight: '3px solid currentColor' }} />
                    </span>
                  )}
                  <span style={{ display: 'block', border: `1px solid ${isFocused ? accent : edge}`, borderRadius: 3, boxShadow: isFocused ? `0 0 14px ${hexMix(accent, bg, 0.4)}` : 'none' }}>
                    <FlagTile team={t} />
                  </span>
                  <span style={{ display: 'block', marginTop: 5, fontSize: 7.5, letterSpacing: '0.08em', fontWeight: isFocused ? 700 : 400, color: isFocused ? accent : dim, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {t.name}
                  </span>
                </button>
              );
            })}
          </div>
        )}
      </div>

      <div style={{ flex: 'none', margin: '0 32px 22px', padding: '12px 18px', background: panel, border: `1px solid ${edge}`, borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, position: 'relative', zIndex: 1 }}>
        {focused ? (
          <>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0 }}>
              <span style={{ fontSize: 15, fontWeight: 700, letterSpacing: '0.1em', color: accent, flex: 'none' }}>{focused.name}</span>
              <span style={{ display: 'flex', gap: 4, flex: 'none' }} aria-hidden>
                <span style={{ width: 14, height: 14, borderRadius: 2, background: accent }} />
                {focused.flag.map((c, i) => (
                  <span key={i} style={{ width: 14, height: 14, borderRadius: 2, background: c, border: `1px solid ${edge}` }} />
                ))}
              </span>
              <span style={{ fontSize: 10, letterSpacing: '0.08em', color: muted }}>{focused.conf}</span>
            </div>
            <span style={{ fontSize: 12, fontWeight: 700, letterSpacing: '0.14em', color: accent, flex: 'none' }}>PRESS ⏎ TO PICK</span>
          </>
        ) : (
          <span style={{ fontSize: 11, letterSpacing: '0.08em', color: muted }}>Type to search, or clear the filter.</span>
        )}
      </div>
    </div>
  );
}
