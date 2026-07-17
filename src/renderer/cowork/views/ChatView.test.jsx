import { describe, it, expect } from 'vitest';
import { modelUnavailableCtas, planAvailabilityLine, prettyModelLabel } from './ChatView.jsx';

// ENG-649: once ENG-596 + the Statsig `tier_locked` rule shipped, `model_disabled`
// means strictly "admin kill switch — down for everyone", so its card must NOT
// offer Upgrade (paying can't fix a kill switch — the ENG-514 wrong-CTA class).
// `model_access_denied` stays the plan-gate code that keeps Upgrade.
describe('modelUnavailableCtas', () => {
  it('offers Upgrade + Switch for the plan gate (model_access_denied)', () => {
    expect(modelUnavailableCtas('model_access_denied')).toEqual(['upgrade', 'switch']);
  });

  it('offers Switch only for the kill switch (model_disabled) — no Upgrade', () => {
    const ctas = modelUnavailableCtas('model_disabled');
    expect(ctas).toEqual(['switch']);
    expect(ctas).not.toContain('upgrade');
  });

  it('defaults to Switch only for any non-plan-gate/unknown code', () => {
    expect(modelUnavailableCtas(undefined)).toEqual(['switch']);
    expect(modelUnavailableCtas('something_else')).toEqual(['switch']);
  });
});

// ENG-598 copy spec (folded into ENG-649): the plan-gate card names what the
// account CAN switch to. 1 model → name it; 2–3 → list them; >3 → 3 + "and N
// more"; empty/absent → drop the line. Labels come from modelLabel, never
// hardcoded, so ids resolve to product names.
describe('planAvailabilityLine', () => {
  it('returns null for an empty or absent list (line is dropped)', () => {
    expect(planAvailabilityLine([])).toBeNull();
    expect(planAvailabilityLine(undefined)).toBeNull();
  });

  it('names the single enabled model', () => {
    expect(planAvailabilityLine(['sonnet'])).toBe('Available on your plan: Sonnet');
  });

  it('joins two models with "and"', () => {
    expect(planAvailabilityLine(['sonnet', 'haiku'])).toBe('Available on your plan: Sonnet and Haiku');
  });

  it('Oxford-joins exactly three models', () => {
    expect(planAvailabilityLine(['sonnet', 'haiku', 'opus']))
      .toBe('Available on your plan: Sonnet, Haiku, and Opus');
  });

  it('shows three then summarizes the rest as "and N more"', () => {
    expect(planAvailabilityLine(['sonnet', 'haiku', 'opus', 'gemini', 'kimi']))
      .toBe('Available on your plan: Sonnet, Haiku, Opus, and 2 more');
  });

  it('resolves ids to product labels via modelLabel', () => {
    expect(planAvailabilityLine(['claude-opus-4-8'])).toBe('Available on your plan: Claude Opus 4.8');
  });
});

// prettyModelLabel backs both the card title and the availability line: it
// capitalizes a bare single-token alias for prose but must never re-case a
// label modelLabel already spaced/cased (e.g. "o4 Mini").
describe('prettyModelLabel', () => {
  it('capitalizes a bare single-word alias', () => {
    expect(prettyModelLabel('sonnet')).toBe('Sonnet');
  });

  it('passes through a multi-word label untouched (never re-cased)', () => {
    expect(prettyModelLabel('claude-opus-4-8')).toBe('Claude Opus 4.8');
    // modelLabel deliberately lowercases the "o4" head — keep it that way.
    expect(prettyModelLabel('o4-mini')).toBe('o4 Mini');
  });

  it('uses the fallback when the id is missing', () => {
    expect(prettyModelLabel(undefined, 'This model')).toBe('This model');
  });

  it('returns empty string when there is no id and no fallback', () => {
    expect(prettyModelLabel(undefined)).toBe('');
    expect(prettyModelLabel('')).toBe('');
  });
});
