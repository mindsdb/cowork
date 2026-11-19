import { afterEach, describe, expect, it, vi } from 'vitest';

const deployment = vi.hoisted(() => ({ PLATFORM_UI: false }));
vi.mock('./deployment', () => deployment);

import { modelPickerMode, operatorEffortLevels, operatorEfforts } from './modelPicker';

function setMeta(content: string, name = 'cowork-model-picker') {
  const meta = document.createElement('meta');
  meta.name = name;
  meta.content = content;
  document.head.append(meta);
}

const EFFORTS = { models: { 'opus-5-5': ['xhigh'], 'gpt-5.6-luna': ['low', 'medium'] }, operatorDefault: ['low'] };

afterEach(() => {
  deployment.PLATFORM_UI = false;
  document.head.querySelectorAll('meta[name^="cowork-model-"]').forEach((node) => node.remove());
});

describe('the operator model picker mode', () => {
  it('is off when the server supplies no setting, as on desktop', () => {
    expect(modelPickerMode()).toBe('off');
  });

  it.each(['default', 'open'] as const)('reads %s from the page', (mode) => {
    setMeta(mode);
    expect(modelPickerMode()).toBe(mode);
  });

  it.each(['', 'off', 'DEFAULT', 'on', 'true', 'locked'])('is off for metadata %j', (value) => {
    setMeta(value);
    expect(modelPickerMode()).toBe('off');
  });

  it('is off with the platform UI on, whose own picker applies', () => {
    deployment.PLATFORM_UI = true;
    setMeta('open');
    expect(modelPickerMode()).toBe('off');
  });
});

describe("the operator's efforts", () => {
  it('reads each model\'s efforts and "Operator default"\'s under the picker', () => {
    setMeta('default');
    setMeta(JSON.stringify(EFFORTS), 'cowork-model-efforts');
    expect(operatorEfforts()).toEqual(EFFORTS);
    expect(operatorEffortLevels('opus-5-5')).toEqual(['xhigh']);
    expect(operatorEffortLevels(null)).toEqual(['low']);
    // A model the operator lets users pick no effort on, and a name the object holds by inheritance.
    expect(operatorEffortLevels('claude-haiku-5-5')).toEqual([]);
    expect(operatorEffortLevels('toString')).toEqual([]);
  });

  it('offers none without the tag', () => {
    setMeta('open');
    expect(operatorEfforts()).toEqual({ models: {}, operatorDefault: [] });
    expect(operatorEffortLevels(null)).toEqual([]);
  });

  it('offers none with the picker off, even with the tag', () => {
    setMeta(JSON.stringify(EFFORTS), 'cowork-model-efforts');
    expect(operatorEffortLevels('opus-5-5')).toEqual([]);
  });

  it('offers none with the platform UI on, whose own effort control applies', () => {
    deployment.PLATFORM_UI = true;
    setMeta('open');
    setMeta(JSON.stringify(EFFORTS), 'cowork-model-efforts');
    expect(operatorEffortLevels('opus-5-5')).toEqual([]);
  });

  it.each([
    '{',
    '[]',
    'null',
    JSON.stringify({ models: { 'opus-5-5': 'xhigh' }, operatorDefault: [] }),
    JSON.stringify({ models: { 'opus-5-5': ['XHIGH'] }, operatorDefault: [] }),
    JSON.stringify({ models: { 'opus-5-5': ['xhigh'] } }),
    JSON.stringify({ models: [], operatorDefault: [1] }),
    JSON.stringify({ models: [['xhigh']], operatorDefault: [] }),
  ])('offers none for a tag it cannot read, %s', (content) => {
    setMeta('default');
    setMeta(content, 'cowork-model-efforts');
    expect(operatorEfforts()).toEqual({ models: {}, operatorDefault: [] });
  });
});
