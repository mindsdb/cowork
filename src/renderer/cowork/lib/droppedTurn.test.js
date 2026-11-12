import { describe, it, expect } from 'vitest';
import {
  isDroppedStream, withoutDroppedRows, droppedError, stopReconnecting, historyEndsTurn,
} from './droppedTurn';

describe('droppedTurn', () => {
  it('counts a lost connection as a drop, not a refused or failed turn', () => {
    expect(isDroppedStream({ code: 'stream_error' })).toBe(true);
    expect(isDroppedStream({ code: 'reconnect_error' })).toBe(true);
    expect(isDroppedStream({ code: 'interrupted' })).toBe(true);
    expect(isDroppedStream({ code: 'stalled' })).toBe(true);
    expect(isDroppedStream({ code: 'stalled', type: 'response.failed' })).toBe(false);
    expect(isDroppedStream({ code: 'stream_error', http_status: 502 })).toBe(false);
    expect(isDroppedStream({ code: 'rate_limited' })).toBe(false);
    expect(isDroppedStream(undefined)).toBe(false);
  });

  it('takes away only the rows the drop left', () => {
    const rows = [
      { role: 'user', content: 'hi' },
      { role: 'assistant', content: 'part', _dropped: true },
      { role: 'error', content: 'network error', _dropped: true, _reconnecting: true },
    ];
    expect(withoutDroppedRows(rows, rows[2])).toEqual([{ role: 'user', content: 'hi' }]);
    expect(droppedError({ messages: rows })?.content).toBe('network error');
    expect(droppedError({ messages: rows.slice(0, 2) })).toBeNull();
    expect(stopReconnecting(rows)[2]._reconnecting).toBe(false);
    expect(stopReconnecting(rows)[1]).toBe(rows[1]);
  });

  it("takes the latest drop's error, and only its own turn's rows go", () => {
    const rows = [
      { role: 'user', id: 'u1', content: 'first' },
      { role: 'assistant', content: 'part 1', _dropped: true, _userMessageId: 'u1' },
      { role: 'error', content: 'lost 1', _dropped: true, _userMessageId: 'u1' },
      { role: 'user', id: 'u2', content: 'second' },
      { role: 'assistant', content: 'part 2', _dropped: true, _userMessageId: 'u2' },
      { role: 'error', content: 'lost 2', _dropped: true, _userMessageId: 'u2' },
    ];
    const latest = droppedError({ messages: rows });
    expect(latest.content).toBe('lost 2');
    expect(withoutDroppedRows(rows, latest).map((m) => m.content)).toEqual(['first', 'part 1', 'lost 1', 'second']);
    // Without ids: the drop's rows after its turn's user message.
    const bare = rows.map(({ _userMessageId, ...m }) => m);
    expect(withoutDroppedRows(bare, droppedError({ messages: bare })).map((m) => m.content))
      .toEqual(['first', 'part 1', 'lost 1', 'second']);
    // An error no longer there changes nothing.
    expect(withoutDroppedRows(rows, { role: 'error' })).toBe(rows);
  });

  it('finds the end of the same turn in the history', () => {
    const history = [
      { role: 'user', id: 'u1' },
      { role: 'assistant', id: 'a1', _turnComplete: true },
      { role: 'user', id: 'u2' },
      { role: 'assistant', id: 'a2', _turnComplete: true },
    ];
    expect(historyEndsTurn(history, 'u2')).toBe(true);
    // An older turn's answer is not this one's.
    expect(historyEndsTurn(history, 'u1')).toBe(false);
    expect(historyEndsTurn(history.slice(0, 3), 'u2')).toBe(false);
    expect(historyEndsTurn([...history.slice(0, 3), { role: 'error' }], 'u2')).toBe(true);
    expect(historyEndsTurn(history, null)).toBe(false);
  });
});
