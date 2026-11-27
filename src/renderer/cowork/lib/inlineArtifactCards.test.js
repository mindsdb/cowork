// ENG-4684: one live frame per inline artifact, at its latest card.
import { describe, it, expect } from 'vitest';
import {
  MESSAGE_CARD_SLOT,
  cardRevisionId,
  isSupersededInline,
  latestInlineArtifactByKey,
} from './inlineArtifactCards';

const data = (over = {}) => ({ slug: 'chart', title: 'Chart', file_path: '/a/chart/index.html', display: 'inline', ...over });
const stepOf = (id, over) => ({ id, badge: 'Artifact', data: data(over) });

describe('latestInlineArtifactByKey', () => {
  it('keeps, per artifact, the last message and card that shows it inline', () => {
    const messages = [
      { steps: [stepOf('artifact-chart')] },
      { content: 'text' },
      { steps: [stepOf('artifact-chart'), stepOf('artifact-other', { slug: 'other', file_path: '/a/other/index.html' })] },
    ];
    const latest = latestInlineArtifactByKey(messages);
    expect(latest.get('chart')).toEqual({ index: 2, slot: 'artifact-chart' });
    expect(latest.get('other')).toEqual({ index: 2, slot: 'artifact-other' });

    expect(isSupersededInline(latest, data(), 0, 'artifact-chart')).toBe(true);
    expect(isSupersededInline(latest, data(), 2, 'artifact-chart')).toBe(false);
  });

  it('keys by the full identity first, so a renamed slug is the same artifact', () => {
    const id = '0123456789abcdef0123456789abcdef';
    const latest = latestInlineArtifactByKey([
      { artifact: data({ id, slug: 'old' }) },
      { steps: [stepOf('s', { id, slug: 'new' })] },
    ]);
    expect(isSupersededInline(latest, data({ id, slug: 'old' }), 0, MESSAGE_CARD_SLOT)).toBe(true);
  });

  it('a later card of the same message wins over the message card', () => {
    const latest = latestInlineArtifactByKey([{ artifact: data(), steps: [stepOf('s')] }]);
    expect(isSupersededInline(latest, data(), 0, MESSAGE_CARD_SLOT)).toBe(true);
    expect(isSupersededInline(latest, data(), 0, 's')).toBe(false);
  });

  it('counts only cards that show inline: the flag, an HTML page, not a fullstack app', () => {
    const latest = latestInlineArtifactByKey([
      { steps: [stepOf('a')] },
      { steps: [stepOf('b', { display: undefined })] },
      { steps: [stepOf('c', { file_path: '/a/chart/data.csv' })] },
      { steps: [stepOf('d', { type: 'fullstack-stateless-app' })] },
    ]);
    expect(latest.get('chart')).toEqual({ index: 0, slot: 'a' });
  });

  it('folds nothing without a map or for an unknown card', () => {
    expect(isSupersededInline(null, data(), 0, 's')).toBe(false);
    expect(isSupersededInline(new Map(), data(), 0, 's')).toBe(false);
    expect(latestInlineArtifactByKey(undefined).size).toBe(0);
  });
});

describe('cardRevisionId', () => {
  it('reads revision_id, then revisionId, else empty', () => {
    expect(cardRevisionId({ revision_id: 'r1', revisionId: 'r2' })).toBe('r1');
    expect(cardRevisionId({ revisionId: 'r2' })).toBe('r2');
    expect(cardRevisionId({})).toBe('');
    expect(cardRevisionId(null)).toBe('');
  });
});
