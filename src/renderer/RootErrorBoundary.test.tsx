import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RootErrorBoundary } from './RootErrorBoundary';

function Throws(): never {
  throw new Error('bad response body');
}

describe('RootErrorBoundary', () => {
  const realLocation = window.location;

  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    Object.defineProperty(window, 'location', {
      configurable: true,
      writable: true,
      value: { ...realLocation, reload: vi.fn() },
    });
  });

  afterEach(() => {
    Object.defineProperty(window, 'location', {
      configurable: true,
      writable: true,
      value: realLocation,
    });
    vi.restoreAllMocks();
  });

  it('shows a reload notice instead of an empty page when a child throws', async () => {
    const { container } = render(
      <RootErrorBoundary>
        <Throws />
      </RootErrorBoundary>
    );

    expect(container.textContent).toContain('Something went wrong');
    expect(container.textContent).not.toContain('bad response body');

    await userEvent.click(screen.getByRole('button', { name: 'Reload' }));
    expect(window.location.reload).toHaveBeenCalledTimes(1);
  });

  it('renders healthy children as they are', () => {
    const { container } = render(
      <RootErrorBoundary>
        <div>app content</div>
      </RootErrorBoundary>
    );

    expect(container.textContent).toBe('app content');
  });
});
