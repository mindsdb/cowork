import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ShellOsCappedNotice, OS_CAPPED_DISMISSED_KEY } from './ShellOsCappedNotice';
import type { ShellSupportVerdict } from '../shared/shell-support';

const capped = (reason: 'behind' | 'below-floor'): ShellSupportVerdict => ({
  status: 'os-capped', reason, shellVersion: '2.26.10.1.1', latestShellVersion: '2.26.10.4.1', daysBehind: 3, macosMajor: 12,
});

beforeEach(() => {
  window.localStorage.clear();
});

describe('ShellOsCappedNotice', () => {
  it('says updates stopped and offers no action button', () => {
    render(<ShellOsCappedNotice verdict={capped('behind')} onDismiss={() => {}} />);
    expect(screen.getByRole('alert')).toHaveTextContent('no longer receives app updates');
    expect(screen.queryByRole('button', { name: /update|download|restart/i })).toBeNull();
  });

  it('remembers a dismissed "behind" notice across launches', () => {
    const onDismiss = vi.fn();
    const { unmount } = render(<ShellOsCappedNotice verdict={capped('behind')} onDismiss={onDismiss} />);
    fireEvent.click(screen.getByRole('button', { name: /dismiss/i }));
    expect(onDismiss).toHaveBeenCalledTimes(1);
    expect(window.localStorage.getItem(OS_CAPPED_DISMISSED_KEY)).toBe('1');
    unmount();
    render(<ShellOsCappedNotice verdict={capped('behind')} onDismiss={() => {}} />);
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('brings the below-floor notice back every launch', () => {
    window.localStorage.setItem(OS_CAPPED_DISMISSED_KEY, '1');
    render(<ShellOsCappedNotice verdict={capped('below-floor')} onDismiss={() => {}} />);
    expect(screen.getByRole('alert')).toHaveTextContent('more than one person signs in');
    fireEvent.click(screen.getByRole('button', { name: /dismiss/i }));
    expect(window.localStorage.getItem(OS_CAPPED_DISMISSED_KEY)).toBe('1');
  });

  it('still shows when storage throws', () => {
    const spy = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked'); });
    render(<ShellOsCappedNotice verdict={capped('behind')} onDismiss={() => {}} />);
    expect(screen.getByRole('alert')).toBeInTheDocument();
    spy.mockRestore();
  });

  it('renders nothing for other verdicts', () => {
    const { container } = render(
      <ShellOsCappedNotice verdict={{ status: 'supported', shellVersion: 'a', latestShellVersion: 'a', daysBehind: 0 }} onDismiss={() => {}} />,
    );
    expect(container).toBeEmptyDOMElement();
  });
});
