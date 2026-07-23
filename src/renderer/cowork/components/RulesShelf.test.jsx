import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import RulesShelf from './RulesShelf';

const api = vi.hoisted(() => ({
  fetchRules: vi.fn(async () => []),
  revokeRule: vi.fn(async () => ({})),
}));
vi.mock('../api', () => api);

const rule = {
  id: 'r1',
  origin: 'mail.google.com',
  actionKind: 'browser_click:send',
  sourceApprovalId: 'ap-1',
  hitCount: 3,
  lastFiredAt: new Date(Date.now() - 5 * 60000).toISOString(),
  revokedAt: null,
  createdAt: new Date().toISOString(),
};

describe('RulesShelf', () => {
  it('renders rules with scope, hit count, and revoke', async () => {
    api.fetchRules.mockImplementation(async () => [rule]);
    render(<RulesShelf />);
    expect(await screen.findByText('Send on mail.google.com')).toBeTruthy();
    expect(screen.getByText(/browser_click · 3× used/)).toBeTruthy();
  });

  it('revoke removes the rule from the shelf', async () => {
    api.fetchRules.mockImplementation(async () => [rule]);
    api.revokeRule.mockClear();
    render(<RulesShelf />);
    const btn = await screen.findByText('Revoke');
    fireEvent.click(btn);
    await waitFor(() => expect(api.revokeRule).toHaveBeenCalledWith('r1'));
    await screen.findByText(/No standing rules/);
  });

  it('empty state reads as asks-each-time', async () => {
    api.fetchRules.mockImplementation(async () => []);
    render(<RulesShelf />);
    expect(await screen.findByText(/No standing rules — Anton asks each time/)).toBeTruthy();
  });

  it('a failed load shows the error, not a crash', async () => {
    api.fetchRules.mockImplementation(async () => { throw new Error('HTTP 500'); });
    render(<RulesShelf />);
    expect(await screen.findByText('HTTP 500')).toBeTruthy();
  });
});
