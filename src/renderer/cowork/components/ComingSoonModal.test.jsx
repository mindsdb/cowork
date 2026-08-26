import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

const openExternal = vi.hoisted(() => vi.fn());
vi.mock('../../platform/host', () => ({ host: { openExternal } }));

import ComingSoonModal from './ComingSoonModal';

beforeEach(() => openExternal.mockClear());

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
});
