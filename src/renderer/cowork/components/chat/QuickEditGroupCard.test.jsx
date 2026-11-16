// The quick-edit card in the artifact's chat (ENG-4227).
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';

const cards = vi.hoisted(() => ({ 'launch-brief': { id: 'a1', slug: 'launch-brief', title: 'Launch brief', type: 'html-app', ext: '.html' } }));
vi.mock('../../lib/artifactsStore', () => ({ useArtifactCardBySlug: (slug) => cards[slug] || null }));

import { QuickEditGroupCard } from './QuickEditGroupCard';

const edit = (n, extra = {}) => ({
  editId: `e${n}`, request: `ask ${n}`, summary: `change ${n}`, changed: [], revisionId: null,
  at: '2026-11-12T10:0' + n + ':00Z', model: null, undone: false, ...extra,
});
const group = (edits, extra = {}) => ({ artifactSlug: 'launch-brief', artifactTitle: 'Launch brief', edits, ...extra });
const rows = () => within(screen.getByRole('list')).getAllByRole('listitem');

describe('QuickEditGroupCard', () => {
  it('names the artifact, says it was edited in the viewer, and counts the changes', () => {
    const onOpen = vi.fn();
    render(<QuickEditGroupCard group={group([edit(1), edit(2)])} onOpenArtifact={onOpen} />);

    expect(screen.getByText('Edited in the viewer')).toBeInTheDocument();
    expect(screen.getByText('2 changes')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Open Launch brief' }));
    expect(onOpen).toHaveBeenCalledWith(cards['launch-brief']);
    expect(rows().map((r) => r.textContent)).toEqual([
      expect.stringContaining('ask 1'), expect.stringContaining('ask 2'),
    ]);
    expect(rows()[0]).toHaveTextContent('change 1');
    expect(rows()[0].querySelector('time')).not.toBeNull();
  });

  it('says one change', () => {
    render(<QuickEditGroupCard group={group([edit(1)])} />);
    expect(screen.getByText('1 change')).toBeInTheDocument();
  });

  it('tags an undone edit', () => {
    render(<QuickEditGroupCard group={group([edit(1), edit(2, { undone: true })])} />);
    expect(rows()[1]).toHaveClass('is-undone');
    expect(within(rows()[1]).getByText('Undone')).toBeInTheDocument();
    expect(within(rows()[0]).queryByText('Undone')).toBeNull();
  });

  it('shows the newest three behind Show all, and all on request', () => {
    render(<QuickEditGroupCard group={group([edit(1), edit(2), edit(3), edit(4), edit(5)])} />);
    expect(rows()).toHaveLength(3);
    expect(rows()[0]).toHaveTextContent('ask 3');

    fireEvent.click(screen.getByRole('button', { name: 'Show all 5' }));
    expect(rows()).toHaveLength(5);
    fireEvent.click(screen.getByRole('button', { name: 'Show fewer' }));
    expect(rows()).toHaveLength(3);
  });

  it("uses the group's title while the artifact is not in the store, and opens nothing", () => {
    render(<QuickEditGroupCard group={group([edit(1)], { artifactSlug: 'gone-1', artifactTitle: 'Old deck' })} onOpenArtifact={vi.fn()} />);
    expect(screen.getByText('Old deck')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Open/ })).toBeNull();
  });

  it('shows no pill for an older note that names no artifact', () => {
    render(<QuickEditGroupCard group={group([edit(1)], { artifactSlug: null, artifactTitle: null })} />);
    expect(screen.getByText('Edited in the viewer')).toBeInTheDocument();
    expect(screen.queryByText('Launch brief')).toBeNull();
  });
});
