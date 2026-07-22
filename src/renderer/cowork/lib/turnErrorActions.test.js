import { describe, it, expect, vi } from 'vitest';
import { providerOverloadedButtons } from './turnErrorActions';

describe('providerOverloadedButtons', () => {
  const labels = (btns) => btns.map((b) => b.label);

  it('managed user (reconnectable) gets Retry ONLY (primary) — never a MindsHub pitch', () => {
    const btns = providerOverloadedButtons({ reconnectable: true, onRetry: () => {}, onOpenSettings: () => {} });
    expect(labels(btns)).toEqual(['Try again']);
    expect(btns[0].primary).toBe(true);
    // ENG-514 guardrail: no "Set up MindsHub" / "Subscribe" for a managed user.
    expect(labels(btns).join(' ')).not.toMatch(/MindsHub|Subscribe/i);
  });

  it('BYOK/direct user leads with MindsHub (primary), Retry secondary', () => {
    const btns = providerOverloadedButtons({ reconnectable: false, onRetry: () => {}, onOpenSettings: () => {} });
    // Order matters — the primary/failover CTA renders first (ticket emphasis).
    expect(labels(btns)).toEqual(['Set up MindsHub', 'Try again']);
    expect(btns.find((b) => b.label === 'Set up MindsHub').primary).toBe(true);
    expect(Boolean(btns.find((b) => b.label === 'Try again').primary)).toBe(false);
  });

  it('unknown reconnectable (null/undefined) is treated as NOT managed — MindsHub CTA shown', () => {
    expect(labels(providerOverloadedButtons({ reconnectable: null }))).toEqual(['Set up MindsHub', 'Try again']);
    expect(labels(providerOverloadedButtons({ reconnectable: undefined }))).toEqual(['Set up MindsHub', 'Try again']);
  });

  it('Retry is disabled when there is nothing to resend', () => {
    const btns = providerOverloadedButtons({ reconnectable: false, onRetry: undefined, onOpenSettings: () => {} });
    const retry = btns.find((b) => b.label === 'Try again');
    expect(retry.disabled).toBe(true);
  });

  it('wires the passed callbacks', () => {
    const onRetry = vi.fn();
    const onOpenSettings = vi.fn();
    const btns = providerOverloadedButtons({ reconnectable: false, onRetry, onOpenSettings });
    btns.find((b) => b.label === 'Try again').onClick();
    btns.find((b) => b.label === 'Set up MindsHub').onClick();
    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(onOpenSettings).toHaveBeenCalledWith('agent');
  });
});
