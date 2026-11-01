/*
 * The sentences a person reads when Cowork leaves a shared page's link live.
 * The cases are in linkLeftLive.test.yaml.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { load } from 'js-yaml';
import { describe, expect, it } from 'vitest';

import { UNRECORDED_LINK_WARNING, republishNotice, stopSharingNotice } from './linkLeftLive';

const CASES = load(readFileSync(join(__dirname, 'linkLeftLive.test.yaml'), 'utf8'));

function expectMessage(message, { says = [], silent = false }) {
  if (silent) {
    expect(message).toBe('');
    return;
  }
  for (const text of says) expect(message).toContain(text);
}

describe('stopSharingNotice', () => {
  it.each(CASES.stopSharing)('$name', ({ result, ...want }) => expectMessage(stopSharingNotice(result), want));
});

describe('republishNotice', () => {
  it.each(CASES.republish)('$name', ({ result, ...want }) => expectMessage(republishNotice(result), want));
});

it('the warning names the administrator, not a command only one deployment has', () => {
  expect(UNRECORDED_LINK_WARNING).toContain('Ask your administrator');
  expect(UNRECORDED_LINK_WARNING).not.toMatch(/make |cowork-self-hosted/);
});
