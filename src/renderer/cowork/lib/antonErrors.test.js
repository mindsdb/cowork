// ENG-1305: pay-as-you-go wording — no surface says Subscribe anymore, and
// the config-error fallback names the free-start path instead.
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isAntonConfigError, normalizeAntonError } from './antonErrors';

describe('normalizeAntonError', () => {
  it('maps config failures to the pay-as-you-go connect line', () => {
    expect(normalizeAntonError('', { code: 'config_required' })).toBe(
      'No LLM provider is connected for this account. Start free with MindsHub or add your own provider in Settings.',
    );
  });

  it('passes non-config errors through', () => {
    expect(normalizeAntonError('boom', {})).toBe('boom');
    expect(normalizeAntonError('', {})).toBe('Could not complete this task.');
  });

  it('classifies config errors by code and by message shape', () => {
    expect(isAntonConfigError('', { code: 'config_required' })).toBe(true);
    expect(isAntonConfigError('Could not resolve authentication method')).toBe(true);
    expect(isAntonConfigError('rate limited', { code: 'token_limit' })).toBe(false);
  });
});

// Copy contract: subscriptions are gone, so no user-facing wording may sell
// one. Sweeps every renderer source for the word Subscribe outside comments —
// a plain word match, not a quoted-string match, because the HomeView
// occurrences this guards against were JSX text children ("&gt;Subscribe&lt;/Button&gt;"),
// which carry no quotes (PR #581 review). The word boundary skips identifiers
// like loadAndSubscribe on its own; comment strips cover the code comments
// that legitimately quote the old wording.
describe('no Subscribe wording anywhere (ENG-1305)', () => {
  it('renderer sources never say Subscribe outside comments', () => {
    const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
    const offenders = [];
    const walk = (dir) => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) { walk(p); continue; }
        if (!/\.(jsx?|tsx?)$/.test(e.name) || /\.test\./.test(e.name)) continue;
        // ponytail: full-line // strip plus /* */ strip — an inline trailing
        // // comment quoting Subscribe would still match, which fails safe
        // (a human looks) rather than silently passing.
        const src = fs.readFileSync(p, 'utf8')
          .replace(/\/\*[\s\S]*?\*\//g, '')
          .replace(/^\s*\/\/.*$/gm, '');
        for (const m of src.matchAll(/\bSubscribe/g)) {
          const line = src.slice(0, m.index).split('\n').length;
          offenders.push(`${p}:${line}`);
        }
      }
    };
    walk(root);
    expect(offenders).toEqual([]);
  });
});
