import { useEffect, useState } from 'react';
import { afterEach, beforeEach, describe, it, expect } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Modal } from './Modal';

// happy-dom has no getAnimations, so Base UI unmounts on close without its
// animation wait. The stub routes close through that wait, as in Chromium.
beforeEach(() => { Element.prototype.getAnimations = () => []; });
afterEach(() => { delete Element.prototype.getAnimations; });

function ClosedByOpeningCommit() {
  const [open, setOpen] = useState(false);
  useEffect(() => { if (open) setOpen(false); }, [open]);
  return <>
    <button type="button" onClick={() => setOpen(true)}>Open</button>
    <Modal open={open} onClose={() => setOpen(false)} ariaLabel="Probe"><p>Body</p></Modal>
  </>;
}

describe('Modal', () => {
  it('unmounts a dialog that an effect of its opening commit closed', async () => {
    render(<ClosedByOpeningCommit />);
    await userEvent.click(screen.getByRole('button', { name: 'Open' }));
    await waitFor(() => expect(document.querySelector('[role=dialog]')).toBeNull(), { timeout: 1000 });
  });

  it('leaves a dialog reopened before the guard fires mounted, without remounting it', async () => {
    const modal = (open) => <Modal open={open} onClose={() => {}} ariaLabel="Probe"><p>Body</p></Modal>;
    const { rerender } = render(modal(true));
    rerender(modal(false));
    rerender(modal(true));
    const dialog = screen.getByRole('dialog', { name: 'Probe' });
    await new Promise((resolve) => setTimeout(resolve, 500));
    expect(dialog.isConnected).toBe(true);
    expect(dialog).toHaveAttribute('data-open');
  });

  it('dims the dialog under a nested one only when asked', () => {
    const backdrops = () => [...document.querySelectorAll('div')].filter((d) => d.style.background === 'rgba(0, 0, 0, 0.45)').length;
    const nested = (dim) => render(
      <Modal open ariaLabel="Outer"><Modal open ariaLabel="Inner" backdropWhenNested={dim}><p>Inner</p></Modal></Modal>,
    );
    const { unmount } = nested(false);
    expect(backdrops()).toBe(1);
    unmount();
    nested(true);
    expect(backdrops()).toBe(2);
  });
});
