// World Cup 2026 team themes — TEMPORARY seasonal feature.
//
// ── Removal plan (after the final, ~July 19 2026) ────────────────────
// Flip WORLD_CUP_2026 to false for an instant kill (the skin entry,
// chooser card, overlay and Settings section all gate on it; users left
// on a team theme normalize back to 'normal' automatically). For the
// permanent cleanup: delete this file, WorldCupOverlay.tsx, and the
// few `WORLD_CUP_2026`-guarded blocks it imports into (skins.ts,
// ThemeSelect.tsx, App.tsx, cowork/App.jsx, SettingsView.jsx).
//
// All 48 themes are DATA, not stylesheets: each team is a recipe fed
// through the same engine as the Custom skin (lib/customTheme.ts), so
// there is no CSS to unship.

import { hexMix, type CustomTheme } from './customTheme';

export const WORLD_CUP_2026 = true;

export type Confederation = 'UEFA' | 'CONMEBOL' | 'CONCACAF' | 'AFC' | 'CAF' | 'OFC';

export interface WorldCupTeam {
  id: string;
  name: string;
  conf: Confederation;
  /** Stylised 8-bit flag: 3 stripes + direction. Not heraldically
      accurate — a consistent pixel abstraction across all 48. */
  flag: [string, string, string];
  flagDir: 'h' | 'v';
  /** Vivid kit/identity colour used as the app accent — chosen to read
      as a UI accent on the team's chosen mode (not a pale tint). */
  accent: string;
  /** Which neutral base the surfaces derive from. `teamRecipe` keeps
      backgrounds near-neutral (lightly accent-washed) so text stays
      readable; the accent carries the team identity. */
  mode: 'light' | 'dark';
}

export const WORLD_CUP_TEAMS: WorldCupTeam[] = [
  // ── UEFA (16) ──────────────────────────────────────────────────────
  { id: 'austria',     name: 'AUSTRIA',        conf: 'UEFA', flag: ['#ED2939', '#ffffff', '#ED2939'], flagDir: 'h', accent: '#D81E34', mode: 'light' },
  { id: 'belgium',     name: 'BELGIUM',        conf: 'UEFA', flag: ['#000000', '#FDB913', '#EF3340'], flagDir: 'v', accent: '#F4C20D', mode: 'dark' },
  { id: 'bosnia',      name: 'BOSNIA & HERZ.', conf: 'UEFA', flag: ['#002F6C', '#FECB00', '#002F6C'], flagDir: 'v', accent: '#FFCE2E', mode: 'dark' },
  { id: 'croatia',     name: 'CROATIA',        conf: 'UEFA', flag: ['#FF0000', '#ffffff', '#171796'], flagDir: 'h', accent: '#D81E34', mode: 'light' },
  { id: 'czechia',     name: 'CZECH REPUBLIC', conf: 'UEFA', flag: ['#ffffff', '#D7141A', '#11457E'], flagDir: 'h', accent: '#3C82D6', mode: 'dark' },
  { id: 'england',     name: 'ENGLAND',        conf: 'UEFA', flag: ['#ffffff', '#CE1124', '#ffffff'], flagDir: 'h', accent: '#CE1124', mode: 'light' },
  { id: 'france',      name: 'FRANCE',         conf: 'UEFA', flag: ['#002395', '#ffffff', '#ED2939'], flagDir: 'v', accent: '#3B6FE0', mode: 'dark' },
  { id: 'germany',     name: 'GERMANY',        conf: 'UEFA', flag: ['#000000', '#DD0000', '#FFCE00'], flagDir: 'h', accent: '#C8102E', mode: 'light' },
  { id: 'netherlands', name: 'NETHERLANDS',    conf: 'UEFA', flag: ['#AE1C28', '#ffffff', '#21468B'], flagDir: 'h', accent: '#FF7A1A', mode: 'dark' },
  { id: 'norway',      name: 'NORWAY',         conf: 'UEFA', flag: ['#BA0C2F', '#ffffff', '#00205B'], flagDir: 'h', accent: '#C8102E', mode: 'light' },
  { id: 'portugal',    name: 'PORTUGAL',       conf: 'UEFA', flag: ['#046A38', '#DA291C', '#DA291C'], flagDir: 'v', accent: '#18A558', mode: 'dark' },
  { id: 'scotland',    name: 'SCOTLAND',       conf: 'UEFA', flag: ['#005EB8', '#ffffff', '#005EB8'], flagDir: 'h', accent: '#4C8FD6', mode: 'dark' },
  { id: 'spain',       name: 'SPAIN',          conf: 'UEFA', flag: ['#AA151B', '#F1BF00', '#AA151B'], flagDir: 'h', accent: '#F4B400', mode: 'dark' },
  { id: 'sweden',      name: 'SWEDEN',         conf: 'UEFA', flag: ['#006AA7', '#FECC02', '#006AA7'], flagDir: 'h', accent: '#FFCD00', mode: 'dark' },
  { id: 'switzerland', name: 'SWITZERLAND',    conf: 'UEFA', flag: ['#DA291C', '#ffffff', '#DA291C'], flagDir: 'h', accent: '#D52B1E', mode: 'light' },
  { id: 'turkey',      name: 'TURKEY',         conf: 'UEFA', flag: ['#E30A17', '#ffffff', '#E30A17'], flagDir: 'h', accent: '#E30A17', mode: 'light' },
  // ── CONMEBOL (6) ───────────────────────────────────────────────────
  { id: 'argentina',   name: 'ARGENTINA',      conf: 'CONMEBOL', flag: ['#75AADB', '#ffffff', '#75AADB'], flagDir: 'h', accent: '#3D8FCC', mode: 'light' },
  { id: 'brazil',      name: 'BRAZIL',         conf: 'CONMEBOL', flag: ['#009C3B', '#FFDF00', '#002776'], flagDir: 'h', accent: '#1AA64A', mode: 'dark' },
  { id: 'colombia',    name: 'COLOMBIA',       conf: 'CONMEBOL', flag: ['#FCD116', '#003893', '#CE1126'], flagDir: 'h', accent: '#FBD20B', mode: 'dark' },
  { id: 'ecuador',     name: 'ECUADOR',        conf: 'CONMEBOL', flag: ['#FFD100', '#0072CE', '#EF3340'], flagDir: 'h', accent: '#2E7BD6', mode: 'dark' },
  { id: 'paraguay',    name: 'PARAGUAY',       conf: 'CONMEBOL', flag: ['#D52B1E', '#ffffff', '#0038A8'], flagDir: 'h', accent: '#D52B1E', mode: 'light' },
  { id: 'uruguay',     name: 'URUGUAY',        conf: 'CONMEBOL', flag: ['#9bc4e2', '#ffffff', '#9bc4e2'], flagDir: 'h', accent: '#2E6DB4', mode: 'light' },
  // ── CONCACAF (6) ───────────────────────────────────────────────────
  { id: 'canada',      name: 'CANADA',         conf: 'CONCACAF', flag: ['#D80621', '#ffffff', '#D80621'], flagDir: 'v', accent: '#D80621', mode: 'light' },
  { id: 'curacao',     name: 'CURAÇAO',        conf: 'CONCACAF', flag: ['#002B7F', '#F9E814', '#002B7F'], flagDir: 'h', accent: '#F2DD1A', mode: 'dark' },
  { id: 'haiti',       name: 'HAITI',          conf: 'CONCACAF', flag: ['#00209F', '#D21034', '#D21034'], flagDir: 'h', accent: '#3A6BD6', mode: 'dark' },
  { id: 'mexico',      name: 'MEXICO',         conf: 'CONCACAF', flag: ['#006847', '#ffffff', '#CE1126'], flagDir: 'v', accent: '#1FA15B', mode: 'dark' },
  { id: 'panama',      name: 'PANAMA',         conf: 'CONCACAF', flag: ['#ffffff', '#DA121A', '#072357'], flagDir: 'h', accent: '#2451A8', mode: 'light' },
  { id: 'usa',         name: 'UNITED STATES',  conf: 'CONCACAF', flag: ['#3C3B6E', '#ffffff', '#B22234'], flagDir: 'v', accent: '#4A7BD8', mode: 'dark' },
  // ── AFC (9) ────────────────────────────────────────────────────────
  { id: 'australia',   name: 'AUSTRALIA',      conf: 'AFC', flag: ['#00843D', '#FFCD00', '#00843D'], flagDir: 'h', accent: '#FFCD00', mode: 'dark' },
  { id: 'iran',        name: 'IRAN',           conf: 'AFC', flag: ['#239F40', '#ffffff', '#DA0000'], flagDir: 'h', accent: '#1B8A3B', mode: 'light' },
  { id: 'iraq',        name: 'IRAQ',           conf: 'AFC', flag: ['#CE1126', '#ffffff', '#000000'], flagDir: 'h', accent: '#C8102E', mode: 'light' },
  { id: 'japan',       name: 'JAPAN',          conf: 'AFC', flag: ['#ffffff', '#BC002D', '#ffffff'], flagDir: 'h', accent: '#3B7DD8', mode: 'dark' },
  { id: 'jordan',      name: 'JORDAN',         conf: 'AFC', flag: ['#000000', '#ffffff', '#007A3D'], flagDir: 'h', accent: '#C8102E', mode: 'light' },
  { id: 'qatar',       name: 'QATAR',          conf: 'AFC', flag: ['#8A1538', '#ffffff', '#8A1538'], flagDir: 'v', accent: '#8A1538', mode: 'light' },
  { id: 'saudi',       name: 'SAUDI ARABIA',   conf: 'AFC', flag: ['#006C35', '#ffffff', '#006C35'], flagDir: 'h', accent: '#1FA15B', mode: 'dark' },
  { id: 'southkorea',  name: 'SOUTH KOREA',    conf: 'AFC', flag: ['#ffffff', '#CD2E3A', '#0047A0'], flagDir: 'h', accent: '#D8232F', mode: 'light' },
  { id: 'uzbekistan',  name: 'UZBEKISTAN',     conf: 'AFC', flag: ['#0099B5', '#ffffff', '#1EB53A'], flagDir: 'h', accent: '#1AA7C0', mode: 'dark' },
  // ── CAF (10) ───────────────────────────────────────────────────────
  { id: 'algeria',     name: 'ALGERIA',        conf: 'CAF', flag: ['#006233', '#ffffff', '#D21034'], flagDir: 'v', accent: '#1B7A43', mode: 'light' },
  { id: 'capeverde',   name: 'CAPE VERDE',     conf: 'CAF', flag: ['#003893', '#ffffff', '#CF2027'], flagDir: 'h', accent: '#2E6FD0', mode: 'dark' },
  { id: 'drcongo',     name: 'DR CONGO',       conf: 'CAF', flag: ['#007FFF', '#F7D618', '#CE1021'], flagDir: 'h', accent: '#2C8BE8', mode: 'dark' },
  { id: 'egypt',       name: 'EGYPT',          conf: 'CAF', flag: ['#CE1126', '#ffffff', '#000000'], flagDir: 'h', accent: '#D9A441', mode: 'dark' },
  { id: 'ghana',       name: 'GHANA',          conf: 'CAF', flag: ['#CE1126', '#FCD116', '#006B3F'], flagDir: 'h', accent: '#F5C518', mode: 'dark' },
  { id: 'ivorycoast',  name: 'IVORY COAST',    conf: 'CAF', flag: ['#FF8200', '#ffffff', '#009A44'], flagDir: 'v', accent: '#E96B12', mode: 'light' },
  { id: 'morocco',     name: 'MOROCCO',        conf: 'CAF', flag: ['#C1272D', '#006233', '#C1272D'], flagDir: 'h', accent: '#D6314A', mode: 'dark' },
  { id: 'senegal',     name: 'SENEGAL',        conf: 'CAF', flag: ['#00853F', '#FDEF42', '#E31B23'], flagDir: 'v', accent: '#2BB36A', mode: 'dark' },
  { id: 'southafrica', name: 'SOUTH AFRICA',   conf: 'CAF', flag: ['#007A4D', '#FFB612', '#DE3831'], flagDir: 'h', accent: '#1B7A43', mode: 'light' },
  { id: 'tunisia',     name: 'TUNISIA',        conf: 'CAF', flag: ['#E70013', '#ffffff', '#E70013'], flagDir: 'h', accent: '#E70013', mode: 'light' },
  // ── OFC (1) ────────────────────────────────────────────────────────
  { id: 'newzealand',  name: 'NEW ZEALAND',    conf: 'OFC', flag: ['#000000', '#ffffff', '#000000'], flagDir: 'h', accent: '#3A4654', mode: 'light' },
];

const TEAM_STORAGE_KEY = 'anton.worldcupTeam';

export function getWorldCupTeam(id: string | null | undefined): WorldCupTeam | null {
  return WORLD_CUP_TEAMS.find((t) => t.id === id) ?? null;
}

export function loadWorldCupTeam(): WorldCupTeam | null {
  try {
    return getWorldCupTeam(window.localStorage.getItem(TEAM_STORAGE_KEY));
  } catch {
    return null;
  }
}

export function persistWorldCupTeam(id: string): void {
  try { window.localStorage.setItem(TEAM_STORAGE_KEY, id); } catch {}
}

// Near-neutral bases. The team bg is only LIGHTLY washed toward the
// accent — enough to feel like the team's colour, little enough that
// the engine's derived ink (light on dark, dark on light) stays clearly
// readable. Saturated full-colour backgrounds (the old approach) killed
// contrast, so the team identity lives in the accent + the picker flags.
const DARK_BASE = '#0b0d12';
const LIGHT_BASE = '#f6f7f9';

/** A team's kit as a custom-theme recipe — applied through the same
    engine as the Custom skin, so no per-team CSS exists anywhere. */
export function teamRecipe(team: WorldCupTeam): CustomTheme {
  const bg = team.mode === 'dark'
    ? hexMix(DARK_BASE, team.accent, 0.12)
    : hexMix(LIGHT_BASE, team.accent, 0.06);
  return {
    accent: team.accent,
    bg,
    radius: 6,
    font: 'standard',
    scanlines: false,
  };
}
