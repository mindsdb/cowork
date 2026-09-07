import { describe, expect, it } from 'vitest';

import type { CodingEvent } from './api';
import { promptHistory } from './presentation';


function event(seq: number, text: string, phase: CodingEvent['phase'] = 'completed'): CodingEvent {
  return {
    schema_version: 1,
    seq,
    timestamp: `2026-08-22T10:00:0${seq}Z`,
    type: 'user_message',
    title: 'You',
    text,
    phase,
    data: {},
  };
}


describe('promptHistory', () => {
  it('returns newest prompts first and keeps the latest duplicate', () => {
    expect(promptHistory([
      event(1, 'Repeat this'),
      event(2, 'Older unique'),
      event(3, 'Repeat this'),
      event(4, 'Still queued', 'pending'),
    ])).toEqual(['Repeat this', 'Older unique']);
  });
});
