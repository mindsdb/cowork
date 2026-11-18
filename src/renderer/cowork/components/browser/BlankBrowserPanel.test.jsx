import { describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import BlankBrowserPanel, { BLANK_LINES, blankLineFor } from './BlankBrowserPanel';
import { typedUrl } from '../../lib/browserSession';

describe('the blank browser page', () => {
  it('keeps one line per task', () => {
    expect(blankLineFor('task-1')).toBe(blankLineFor('task-1'));
    expect(BLANK_LINES).toContain(blankLineFor('task-2'));
  });

  it('tells an address from a search', () => {
    expect(typedUrl(' example.com/pricing ')).toBe('https://example.com/pricing');
    expect(typedUrl('https://news.ycombinator.com')).toBe('https://news.ycombinator.com');
    expect(typedUrl('localhost:3000')).toBe('https://localhost:3000');
    expect(typedUrl('best tacos in SF')).toBeNull();
    expect(typedUrl('tacos')).toBeNull();
    expect(typedUrl('javascript:alert(1)')).toBeNull();
  });

  it('opens an address from the address bar at once, and sends a search to Anton', async () => {
    const onOpenUrl = vi.fn(async () => {});
    const onSend = vi.fn();
    const extra = <button type="button">Call Anton</button>;
    render(<BlankBrowserPanel onOpenUrl={onOpenUrl} onSend={onSend} onClose={vi.fn()} extraActions={extra} />);
    expect(screen.getByRole('button', { name: 'Call Anton' })).toBeInTheDocument();

    fireEvent.change(screen.getByRole('textbox', { name: 'Address' }), { target: { value: 'example.com' } });
    await act(async () => { fireEvent.submit(screen.getByRole('textbox', { name: 'Address' })); });
    expect(onOpenUrl).toHaveBeenCalledWith('https://example.com');
    expect(onSend).not.toHaveBeenCalled();
  });

  it('sends a search from the middle box to Anton, and opens a link pasted there', async () => {
    const onOpenUrl = vi.fn(async () => {});
    const onSend = vi.fn();
    const { unmount } = render(<BlankBrowserPanel onOpenUrl={onOpenUrl} onSend={onSend} onClose={vi.fn()} />);
    fireEvent.change(screen.getByRole('textbox', { name: 'What to look up' }), { target: { value: 'best tacos' } });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Go' })); });
    expect(onSend).toHaveBeenCalledWith('Search the web in the browser for: best tacos');
    unmount();

    render(<BlankBrowserPanel onOpenUrl={onOpenUrl} onSend={onSend} onClose={vi.fn()} />);
    fireEvent.change(screen.getByRole('textbox', { name: 'What to look up' }), { target: { value: 'https://example.com/a' } });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Go' })); });
    expect(onOpenUrl).toHaveBeenCalledWith('https://example.com/a');
  });

  it('says why an address could not open', async () => {
    const onOpenUrl = vi.fn(async () => { throw new Error('Today’s browsing allowance is used up.'); });
    render(<BlankBrowserPanel onOpenUrl={onOpenUrl} onClose={vi.fn()} />);
    fireEvent.change(screen.getByRole('textbox', { name: 'Address' }), { target: { value: 'example.com' } });
    await act(async () => { fireEvent.submit(screen.getByRole('textbox', { name: 'Address' })); });
    expect(screen.getByRole('alert')).toHaveTextContent('Today’s browsing allowance is used up.');
  });
});
