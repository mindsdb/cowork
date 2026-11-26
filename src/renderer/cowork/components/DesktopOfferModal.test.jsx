import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

const openExternal = vi.hoisted(() => vi.fn());
vi.mock('../../platform/host', () => ({ host: { openExternal, isWeb: true, isMobileShell: false } }));
const analytics = vi.hoisted(() => ({
  trackDesktopOfferShown: vi.fn(),
  trackDesktopOfferDownloadClicked: vi.fn(),
}));
vi.mock('../lib/analytics', () => analytics);

import DesktopOfferModal from './DesktopOfferModal';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('DesktopOfferModal', () => {
  // At tablet widths the sidebar is a drawer at layer 101 over a backdrop at
  // 100, and it stays open behind an offer chosen from it.
  it('opens above the tablet sidebar drawer and its backdrop', () => {
    render(<DesktopOfferModal feature="code_mode" entry="sidebar_switch" onClose={vi.fn()} />);
    const layers = [];
    for (let el = screen.getByRole('dialog'); el; el = el.parentElement) {
      const z = Number(el.style?.zIndex);
      if (z) layers.push(z);
    }
    expect(layers.length).toBeGreaterThan(0);
    expect(Math.min(...layers)).toBeGreaterThan(101);
  });

  it('stays closed, and records nothing, without a feature', () => {
    render(<DesktopOfferModal feature={null} entry="sidebar_switch" onClose={vi.fn()} />);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(analytics.trackDesktopOfferShown).not.toHaveBeenCalled();
  });

  it('names Code mode and what the desktop app adds, and records the offer once', () => {
    const { rerender } = render(<DesktopOfferModal feature="code_mode" entry="sidebar_switch" onClose={vi.fn()} />);
    expect(screen.getByRole('dialog', { name: 'Code mode runs in the Desktop app' })).toBeInTheDocument();
    expect(screen.getByText('Run commands and tests on your machine')).toBeInTheDocument();
    expect(screen.queryByText(/coming soon/i)).toBeNull();
    rerender(<DesktopOfferModal feature="code_mode" entry="sidebar_switch" onClose={vi.fn()} />);
    expect(analytics.trackDesktopOfferShown).toHaveBeenCalledTimes(1);
    expect(analytics.trackDesktopOfferShown).toHaveBeenCalledWith({ feature: 'code_mode', entry: 'sidebar_switch' });
  });

  it('words the folder offer for where the person came from', () => {
    const { unmount } = render(<DesktopOfferModal feature="local_folder" entry="new_project" onClose={vi.fn()} />);
    expect(screen.getByRole('dialog', { name: 'Use a folder on your computer in the Desktop app' })).toBeInTheDocument();
    unmount();
    render(<DesktopOfferModal feature="local_folder" entry="chat_context" onClose={vi.fn()} />);
    expect(screen.getByRole('dialog', { name: 'Working folders are in the Desktop app' })).toBeInTheDocument();
    expect(screen.getByText('For Mac, Windows and Linux. Here in the browser, you can still upload files.')).toBeInTheDocument();
  });

  it('opens the download tagged for the feature, records the click and closes', () => {
    const onClose = vi.fn();
    render(<DesktopOfferModal feature="local_folder" entry="chat_context" onClose={onClose} />);
    fireEvent.click(screen.getByRole('button', { name: 'Download the Desktop app' }));
    expect(openExternal).toHaveBeenCalledWith('https://mindshub.ai/download?os=auto&from=cowork-web-folder');
    expect(analytics.trackDesktopOfferDownloadClicked).toHaveBeenCalledWith({ feature: 'local_folder', entry: 'chat_context' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('closes on Not now without opening anything', () => {
    const onClose = vi.fn();
    render(<DesktopOfferModal feature="code_mode" entry="sidebar_switch" onClose={onClose} />);
    fireEvent.click(screen.getByRole('button', { name: 'Not now' }));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(openExternal).not.toHaveBeenCalled();
    expect(analytics.trackDesktopOfferDownloadClicked).not.toHaveBeenCalled();
  });
});
