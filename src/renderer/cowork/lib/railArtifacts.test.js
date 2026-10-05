import { describe, expect, it } from 'vitest';

import { RAIL_OTHER_LIMIT, isFromConversation, railArtifactRows } from './railArtifacts';

const art = (path, originConversationId = '') => ({ path, originConversationId });

describe('isFromConversation', () => {
  it('matches the conversation that created the artifact', () => {
    expect(isFromConversation(art('/a', 'c1'), 'c1')).toBe(true);
    expect(isFromConversation(art('/a', 'c2'), 'c1')).toBe(false);
  });

  it('never matches without a conversation or provenance', () => {
    expect(isFromConversation(art('/a', ''), '')).toBe(false);
    expect(isFromConversation(art('/a', ''), null)).toBe(false);
    expect(isFromConversation(art('/a'), 'c1')).toBe(false);
    expect(isFromConversation(null, 'c1')).toBe(false);
  });
});

describe('railArtifactRows', () => {
  it('puts the current conversation first and keeps newest-first order inside each group', () => {
    const list = [art('/o1', 'c2'), art('/m1', 'c1'), art('/o2'), art('/m2', 'c1')];
    expect(railArtifactRows(list, 'c1').map((a) => a.path)).toEqual(['/m1', '/m2', '/o1', '/o2']);
  });

  it('caps only the other artifacts', () => {
    const others = Array.from({ length: RAIL_OTHER_LIMIT + 3 }, (_, i) => art(`/o${i}`, 'c2'));
    const mine = Array.from({ length: 15 }, (_, i) => art(`/m${i}`, 'c1'));
    const rows = railArtifactRows([...others, ...mine], 'c1');
    expect(rows).toHaveLength(15 + RAIL_OTHER_LIMIT);
    expect(rows.slice(0, 15).every((a) => a.originConversationId === 'c1')).toBe(true);
    expect(rows[15].path).toBe('/o0');
  });

  it('keeps the old top-12 behaviour without a conversation', () => {
    const list = Array.from({ length: 20 }, (_, i) => art(`/a${i}`, 'c1'));
    expect(railArtifactRows(list, null).map((a) => a.path))
      .toEqual(list.slice(0, RAIL_OTHER_LIMIT).map((a) => a.path));
  });

  it('returns an empty list for a non-array response', () => {
    expect(railArtifactRows(undefined, 'c1')).toEqual([]);
    expect(railArtifactRows({ detail: 'x' }, 'c1')).toEqual([]);
  });
});
