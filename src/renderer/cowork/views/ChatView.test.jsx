import { describe, it, expect } from 'vitest';
import { modelUnavailableCtas } from './ChatView.jsx';

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
