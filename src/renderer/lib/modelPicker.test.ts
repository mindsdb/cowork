import { afterEach, describe, expect, it, vi } from 'vitest';

const deployment = vi.hoisted(() => ({ PLATFORM_UI: false }));
vi.mock('./deployment', () => deployment);

import { modelPickerMode } from './modelPicker';

function setMeta(content: string) {
  const meta = document.createElement('meta');
  meta.name = 'cowork-model-picker';
  meta.content = content;
  document.head.append(meta);
}

afterEach(() => {
  deployment.PLATFORM_UI = false;
  document.head.querySelectorAll('meta[name="cowork-model-picker"]').forEach((node) => node.remove());
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
