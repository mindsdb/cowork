import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import BrowserTabPicker from './BrowserTabPicker';

const TABS = [
  { targetId: 'T1', title: 'Payments API reference — Stripe Docs', url: 'https://docs.stripe.com/api/charges', domain: 'stripe.com' },
  { targetId: 'T2', title: 'Inbox (14)', url: 'https://mail.google.com/mail/u/0', domain: 'google.com' },
];

describe('BrowserTabPicker', () => {
  it('renders nothing when closed', () => {
    const { container } = render(<BrowserTabPicker open={false} tabs={TABS} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('is a modal dialog listing tabs (title + domain)', () => {
    render(<BrowserTabPicker open tabs={TABS} onConfirm={() => {}} onClose={() => {}} />);
    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(screen.getAllByRole('radio')).toHaveLength(2);
    expect(screen.getByText('stripe.com')).toBeInTheDocument();
  });

  it('sets the dedicated-window expectation under the heading', () => {
    render(<BrowserTabPicker open tabs={TABS} onConfirm={() => {}} onClose={() => {}} />);
    expect(
      screen.getByText(/dedicated Chrome window\. You can also just ask the agent to open a site/),
    ).toBeInTheDocument();
  });

  it('confirm is disabled until a tab is selected, then confirms with its targetId', async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    render(<BrowserTabPicker open tabs={TABS} onConfirm={onConfirm} onClose={() => {}} />);

    const approve = screen.getByRole('button', { name: 'Approve this tab' });
    expect(approve).toBeDisabled();

    await user.click(screen.getByRole('radio', { name: /Stripe Docs/ }));
    expect(approve).toBeEnabled();
    // Domain-scope echo is shown for the selection.
    expect(screen.getByText('stripe.com', { selector: 'strong' })).toBeInTheDocument();

    await user.click(approve);
    expect(onConfirm).toHaveBeenCalledWith('T1');
  });

  it('shows an empty state pointing at the dedicated Chrome window when there are no tabs', () => {
    render(<BrowserTabPicker open tabs={[]} onConfirm={() => {}} onClose={() => {}} />);
    // The dedicated debug-profile window may have opened BEHIND the app on
    // macOS — the copy must point there, not at the user's regular Chrome.
    expect(screen.getByText(/No open tabs in Cowork's Chrome window/)).toBeInTheDocument();
    expect(screen.getByText(/behind this window/)).toBeInTheDocument();
    expect(screen.queryAllByRole('radio')).toHaveLength(0);
  });

  it('empty state renders Try again and calls onRetry', async () => {
    const user = userEvent.setup();
    const onRetry = vi.fn();
    render(<BrowserTabPicker open tabs={[]} onRetry={onRetry} onConfirm={() => {}} onClose={() => {}} />);
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('error state shows the real failure reason + Try again, not the empty-state copy', async () => {
    const user = userEvent.setup();
    const onRetry = vi.fn();
    render(
      <BrowserTabPicker
        open
        tabs={[]}
        error="Could not find Google Chrome. Install Chrome to use Browser Control."
        onRetry={onRetry}
        onConfirm={() => {}}
        onClose={() => {}}
      />,
    );
    expect(screen.getByTestId('browser-tab-picker-error')).toHaveTextContent(/Could not find Google Chrome/);
    // The misleading "no open tabs" copy must NOT render alongside a failure.
    expect(screen.queryByText(/No open tabs in Cowork's Chrome window/)).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('Esc closes the picker', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<BrowserTabPicker open tabs={TABS} onConfirm={() => {}} onClose={onClose} />);
    await user.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalled();
  });

  it('Cancel closes without confirming', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    const onConfirm = vi.fn();
    render(<BrowserTabPicker open tabs={TABS} onConfirm={onConfirm} onClose={onClose} />);
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onClose).toHaveBeenCalled();
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('moves focus to the dialog on open and labels it', () => {
    render(<BrowserTabPicker open tabs={TABS} onConfirm={() => {}} onClose={() => {}} />);
    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveAttribute('aria-labelledby', 'browser-tab-picker-title');
    expect(dialog).toHaveFocus();
    // The radio group is labelled so SR users hear what the list is.
    expect(screen.getByRole('radiogroup', { name: 'Open Chrome tabs' })).toBeInTheDocument();
  });

  it('traps Tab focus inside the dialog (focus wraps, never escapes)', async () => {
    const user = userEvent.setup();
    render(
      <>
        <button type="button">outside</button>
        <BrowserTabPicker open tabs={TABS} onConfirm={() => {}} onClose={() => {}} />
      </>,
    );
    const dialog = screen.getByRole('dialog');
    // Shift+Tab from the dialog wraps to the last focusable control, not the
    // outside button behind the modal.
    await user.tab({ shift: true });
    expect(document.activeElement).not.toBe(screen.getByRole('button', { name: 'outside' }));
    expect(dialog.contains(document.activeElement)).toBe(true);
  });
});
