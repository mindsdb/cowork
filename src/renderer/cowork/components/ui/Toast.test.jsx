import { describe, expect, it, vi } from 'vitest';
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

function ActionHarness({ onAction }) {
  const toastManager = useToastManager();
  return (
    <>
      <button onClick={() => toastManager.add({ title: 'Plain toast', timeout: 0 })}>Add plain</button>
      <button
        onClick={() => toastManager.add({
          title: 'Toast with action',
          timeout: 0,
          actionProps: { children: 'Open task', onClick: onAction },
        })}
      >
        Add with action
      </button>
    </>
  );
}

describe('ToastProvider', () => {
  it('shows an action button only on a toast that carries one', async () => {
    const user = userEvent.setup();
    const onAction = vi.fn();
    render(
      <ToastProvider>
        <ActionHarness onAction={onAction} />
      </ToastProvider>,
    );

    await user.click(screen.getByRole('button', { name: 'Add plain' }));
    expect(screen.getByText('Plain toast')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Open task' })).toBeNull();

    await user.click(screen.getByRole('button', { name: 'Add with action' }));
    await user.click(screen.getByRole('button', { name: 'Open task' }));
    expect(onAction).toHaveBeenCalledTimes(1);
  });

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
