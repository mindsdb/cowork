// The menus draw each kind and tone by its key: a kind added to canvasOps
// without an icon here would draw nothing.
import { describe, expect, it } from 'vitest';
import { BLOCK_ICONS, TONE_ICONS } from './blockIcons';
import { CALLOUT_TONES, INSERTABLE, TURN_INTO, slashItems } from './canvasOps';

describe('block icons', () => {
  it('cover every kind the menus offer, and every callout tone', () => {
    for (const item of [...TURN_INTO, ...INSERTABLE, ...slashItems('', true, true)]) expect(BLOCK_ICONS[item.key]).toBeTruthy();
    for (const t of CALLOUT_TONES) expect(TONE_ICONS[t.tone]).toBeTruthy();
  });
});
