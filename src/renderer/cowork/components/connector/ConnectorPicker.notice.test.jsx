// A connector can carry a short `notice` in its spec JSON — something true
// about connecting that a user is better off knowing before they start.
// HubSpot is the first: its Marketplace listing is under review, so HubSpot
// itself shows an "unverified app" warning mid-flow, and a user who hasn't
// been told that reasonably reads it as our connector being broken.
//
// Spec-driven on purpose: the tile renders the badge for any connector whose
// JSON sets `notice`, so adding or clearing one is a spec edit, never a
// renderer change with a connector id in it.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

const fetchConnectors = vi.fn();
vi.mock('../../api', () => ({
  fetchConnectors: (...args) => fetchConnectors(...args),
}));
vi.mock('../../../platform/host', () => ({
  host: { openExternal: vi.fn() },
}));

import ConnectorPicker from './ConnectorPicker';

const NOTICE =
  'HubSpot shows an "unverified app" warning when you connect — expected '
  + 'while our Marketplace listing is under review.';

const HUBSPOT = { id: 'hubspot', label: 'HubSpot', category: 'crm', notice: NOTICE };
const SLACK = { id: 'slack', label: 'Slack', category: 'communication' };

afterEach(() => {
  fetchConnectors.mockReset();
});

describe('ConnectorPicker — per-connector notice badge', () => {
  it('marks a connector that carries a notice and leaves the others bare', async () => {
    fetchConnectors.mockResolvedValue([HUBSPOT, SLACK]);
    render(<ConnectorPicker open onPick={vi.fn()} onClose={vi.fn()} />);

    // Exactly one info marker — Slack declares no notice, so its tile gets no
    // extra markup at all.
    expect(await screen.findAllByText(NOTICE)).toHaveLength(1);
  });

  it('exposes the notice as text, not only through the hover tooltip', async () => {
    // The icon is aria-hidden (lucide sets that itself), the marker is
    // deliberately not focusable, and Base UI only wires aria-describedby
    // once the popup opens — so without visually-hidden copy the notice
    // would reach sighted mouse users only.
    fetchConnectors.mockResolvedValue([HUBSPOT]);
    render(<ConnectorPicker open onPick={vi.fn()} onClose={vi.fn()} />);

    const hidden = await screen.findByText(NOTICE);
    expect(hidden.className).toContain('sr-only');
    expect(hidden.textContent).toContain('unverified app');
  });

  it('does not nest a focusable element inside the tile button', async () => {
    // The tile is itself a <button>; a focusable marker inside it would be
    // invalid markup and would put a second tab stop on every tile.
    fetchConnectors.mockResolvedValue([HUBSPOT]);
    render(<ConnectorPicker open onPick={vi.fn()} onClose={vi.fn()} />);

    const marker = (await screen.findByText(NOTICE)).parentElement;
    expect(marker.closest('button')).toBeTruthy();
    expect(marker.tagName).toBe('SPAN');
    expect(marker.hasAttribute('tabindex')).toBe(false);
    // The visible part is an icon, not a word.
    expect(marker.querySelector('svg')).toBeTruthy();
  });
});
