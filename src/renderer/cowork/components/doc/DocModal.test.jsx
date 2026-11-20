// DocModal opens full screen or at the artifact viewer's size, as the viewer
// does, and shares the remembered choice with it.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';

vi.mock('./docApi');
vi.mock('../ui/Modal', () => ({
  Modal: ({ children, fullBleed }) => <div data-testid="modal" data-full-bleed={fullBleed ? 'true' : 'false'}>{children}</div>,
}));

import DocModal from './DocModal';
import * as api from './docApi';
import { host } from '../../../platform/host';
import { LAYOUT_STORAGE_KEY } from '../artifact/useViewerLayout';

const doc = {
  schema: 'cowork.doc/1',
  id: 'a1',
  title: 'Vendor shortlist',
  rev: 1,
  updated_at: new Date().toISOString(),
  tabs: [{ id: 't_1', title: 'Vendor shortlist', blocks: [{ id: 'b_1', type: 'paragraph', text: 'Acme', v: 1 }] }],
};

const artifact = { id: 'a1', projectId: 'p1', title: 'Vendor shortlist' };
const modal = () => screen.getByTestId('modal');
const pane = () => screen.getByRole('region', { name: 'Vendor shortlist' });

async function renderModal() {
  const view = render(<DocModal artifact={artifact} onClose={() => {}} />);
  await screen.findByRole('textbox', { name: 'Title' });
  return view;
}

beforeEach(() => {
  window.localStorage.clear();
  api.resetDocApi();
  api.fetchDoc.mockResolvedValue({ doc, capabilities: { canEdit: true } });
});

afterEach(() => {
  window.localStorage.clear();
});

describe('DocModal', () => {
  it('opens full screen, and leaves and goes back to it from the button and from Ctrl+Shift+Enter', async () => {
    await renderModal();
    expect(modal()).toHaveAttribute('data-full-bleed', 'true');

    fireEvent.click(screen.getByRole('button', { name: 'Exit full screen' }));
    expect(modal()).toHaveAttribute('data-full-bleed', 'false');
    expect(screen.getByRole('button', { name: 'Full screen' })).toBeInTheDocument();

    fireEvent.keyDown(window, { key: 'Enter', ctrlKey: true, shiftKey: true });
    expect(modal()).toHaveAttribute('data-full-bleed', 'true');
    expect(screen.getByRole('button', { name: 'Exit full screen' })).toBeInTheDocument();
  });

  it('opens at the size the artifact viewer was last left at', async () => {
    window.localStorage.setItem(LAYOUT_STORAGE_KEY, JSON.stringify({ maximized: false }));
    const first = await renderModal();
    expect(modal()).toHaveAttribute('data-full-bleed', 'false');

    fireEvent.click(screen.getByRole('button', { name: 'Full screen' }));
    first.unmount();

    await renderModal();
    expect(modal()).toHaveAttribute('data-full-bleed', 'true');
  });

  it('keeps close at the end of the line, after full screen', async () => {
    await renderModal();
    const controls = document.querySelector('.doc-header__window-controls');
    const labels = within(controls).getAllByRole('button').map((b) => b.getAttribute('aria-label'));
    expect(labels).toEqual(['Exit full screen', 'Close doc']);
  });

  it('is the window title bar on a Mac only while full screen', async () => {
    const wasElectron = host.isElectron;
    host.isElectron = true;
    const isMac = vi.spyOn(host, 'isMac').mockReturnValue(true);
    try {
      await renderModal();
      expect(pane()).toHaveAttribute('data-corner', 'window');
      expect(screen.getByRole('button', { name: 'Exit full screen' })).toHaveAttribute('aria-keyshortcuts', 'Meta+Shift+Enter');

      fireEvent.click(screen.getByRole('button', { name: 'Exit full screen' }));
      expect(pane()).not.toHaveAttribute('data-corner');
    } finally { host.isElectron = wasElectron; isMac.mockRestore(); }
  });
});
