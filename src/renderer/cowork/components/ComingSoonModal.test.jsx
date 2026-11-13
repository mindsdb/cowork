import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

const openExternal = vi.hoisted(() => vi.fn());
const hostState = vi.hoisted(() => ({ isMobileShell: false }));
vi.mock('../../platform/host', () => ({
  host: { openExternal, get isMobileShell() { return hostState.isMobileShell; } },
}));

import ComingSoonModal from './ComingSoonModal';

beforeEach(() => {
  openExternal.mockClear();
  hostState.isMobileShell = false;
});

// ENG-4023: a phone cannot install the desktop app, so the app offers no
// download, only the note and a way out.
it('offers no download inside the mobile app', () => {
  hostState.isMobileShell = true;
  const onClose = vi.fn();
  render(<ComingSoonModal feature="Channels" onClose={onClose} />);
  expect(screen.queryByText('Download the app')).toBeNull();
  fireEvent.click(screen.getAllByRole('button', { name: 'Close' }).at(-1));
  expect(onClose).toHaveBeenCalledTimes(1);
  expect(openExternal).not.toHaveBeenCalled();
});

describe('ComingSoonModal', () => {
  it('stays closed when no feature is set', () => {
    render(<ComingSoonModal feature={null} onClose={vi.fn()} />);
    expect(screen.queryByText('Coming soon to Cloud')).toBeNull();
  });

  it('interpolates the feature name into the body copy', () => {
    render(<ComingSoonModal feature="Channels" onClose={vi.fn()} />);
    expect(
      screen.getByText(/Channels isn’t\s+available on Cloud just yet/),
    ).toBeTruthy();
  });

  it('opens the download link with the os=auto + from=cowork-web params and closes', () => {
    const onClose = vi.fn();
    render(<ComingSoonModal feature="Channels" onClose={onClose} />);

    fireEvent.click(screen.getByText('Download the app'));

    expect(openExternal).toHaveBeenCalledWith(
      'https://mindshub.ai/download?os=auto&from=cowork-web',
    );
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('closes without opening a link on "Not now"', () => {
    const onClose = vi.fn();
    render(<ComingSoonModal feature="Channels" onClose={onClose} />);

    fireEvent.click(screen.getByText('Not now'));

    expect(openExternal).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('offers the custom route in place of the download when given one', () => {
    const onClose = vi.fn();
    const onAccept = vi.fn();
    render(<ComingSoonModal feature="HasData" onClose={onClose}
      offer={{ label: 'Connect your custom HasData', onAccept }} />);

    expect(screen.queryByText('Download the app')).toBeNull();
    expect(screen.getByText(/connect it now as a custom connector/)).toBeTruthy();
    fireEvent.click(screen.getByText('Connect your custom HasData'));

    expect(onAccept).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(openExternal).not.toHaveBeenCalled();
  });
});
