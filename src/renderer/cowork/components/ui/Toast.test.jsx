import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ToastProvider, useToastManager } from './Toast';

function FourToastHarness() {
  const toastManager = useToastManager();

  const addToasts = () => {
    for (let index = 1; index <= 4; index += 1) {
      toastManager.add({
        title: `Persistent toast ${index}`,
        timeout: 0,
      });
    }
  };

  return <button onClick={addToasts}>Add four toasts</button>;
}

describe('ToastProvider', () => {
  it('keeps every persistent toast dismissible beyond Base UI\'s default limit', async () => {
    const user = userEvent.setup();
    render(
      <ToastProvider>
        <FourToastHarness />
      </ToastProvider>,
    );

    await user.click(screen.getByRole('button', { name: 'Add four toasts' }));

    const toasts = screen.getAllByRole('dialog');
    expect(toasts).toHaveLength(4);
    expect(toasts.every((toast) => !toast.hasAttribute('inert'))).toBe(true);
    expect(document.querySelectorAll('button[aria-label="Dismiss"]')).toHaveLength(4);
    for (let index = 1; index <= 4; index += 1) {
      expect(screen.getByText(`Persistent toast ${index}`)).toBeInTheDocument();
    }
  });
});
