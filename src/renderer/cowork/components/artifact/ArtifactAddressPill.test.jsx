import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

const copyText = vi.hoisted(() => vi.fn(async () => true));
vi.mock('../../lib/clipboard', () => ({ copyText }));

import { ArtifactAddressPill, displayAddress, middleEllipsis, splitAddress } from './ArtifactAddressPill';

describe('ArtifactAddressPill', () => {
  it('shows a published address without its scheme, and copies the whole of it', async () => {
    render(<ArtifactAddressPill kind="published" url="https://pages.example/launch-brief/" fallback="Launch" canOpen onOpen={vi.fn()} />);
    const text = document.querySelector('.artifact-address-pill-text');
    expect(text).toHaveTextContent('pages.example/launch-brief');
    expect(text).toHaveAttribute('title', 'https://pages.example/launch-brief/');
    fireEvent.click(screen.getByRole('button', { name: 'Copy address' }));
    expect(copyText).toHaveBeenCalledWith('https://pages.example/launch-brief/');
    expect(await screen.findByRole('button', { name: 'Copied' })).toBeInTheDocument();
  });

  it('names a draft with no address yet by its slug, offers no copy, and mints the link on open', () => {
    const onOpen = vi.fn();
    render(<ArtifactAddressPill kind="draft" url="" fallback="launch-brief-a1b2" canOpen onOpen={onOpen} />);
    expect(screen.getByText('Draft')).toBeInTheDocument();
    expect(screen.getByText('launch-brief-a1b2')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Copy address' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Open in a browser tab' }));
    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it('offers no open-in-a-tab where the old button would not have been', () => {
    render(<ArtifactAddressPill kind="draft" url="https://cowork.example/d/x.csv" fallback="x" canOpen={false} onOpen={vi.fn()} />);
    expect(screen.queryByRole('button', { name: 'Open in a browser tab' })).toBeNull();
  });

  it('cuts a long address in the middle and keeps its end', () => {
    const long = 'cowork.example/api/v1/artifacts/drafts/11111111-2222/aaaaaaaa/mindshub-explainer-a8c2272e';
    const cut = middleEllipsis(long, 40);
    expect(cut).toHaveLength(40);
    expect(cut).toContain('…');
    expect(cut.endsWith('explainer-a8c2272e')).toBe(true);
    expect(middleEllipsis('short', 40)).toBe('short');
    expect(displayAddress('http://a.example/')).toBe('a.example');
  });

  it('keeps the slug as its own, never-shrinking tail; the host and path give way first', () => {
    render(<ArtifactAddressPill kind="published" url="https://view-pr-cowork-1422.dev.mindshub.ai/p/mindshub-explainer-a8c2272e" fallback="x" canOpen={false} onOpen={vi.fn()} />);
    expect(document.querySelector('.artifact-address-pill-head')).toHaveTextContent('view-pr-cowork-1422.dev.mindshub.ai/p/');
    expect(document.querySelector('.artifact-address-pill-tail')).toHaveTextContent(/^mindshub-explainer-a8c2272e$/);
    expect(splitAddress('a.example')).toEqual({ head: '', tail: 'a.example' });
    expect(splitAddress('a.example/x/y')).toEqual({ head: 'a.example/x/', tail: 'y' });
  });
});
