import { describe, it, expect, vi } from 'vitest';
import { composerPrefillHandler } from './composerPrefill';

describe('composerPrefillHandler', () => {
  it('hands the composer the text, the selection and whether to send it', () => {
    const set = vi.fn();
    composerPrefillHandler(set)('Build a KPI dashboard', undefined, true);
    expect(set).toHaveBeenCalledWith(expect.objectContaining({ text: 'Build a KPI dashboard', select: undefined, send: true, bump: expect.any(Number) }));
  });

  it('never sends unless asked', () => {
    const set = vi.fn();
    composerPrefillHandler(set)('Draft a reply', [0, 5]);
    expect(set).toHaveBeenCalledWith(expect.objectContaining({ select: [0, 5], send: false }));
  });
});
