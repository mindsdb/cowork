import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { PromptQueue } from './ComposerMenus';


const items = [
  { id: 'queued-1', prompt: 'Run Windows tests', created_at: '2026-08-22T10:01:00Z' },
  { id: 'queued-2', prompt: 'Then summarize the change', created_at: '2026-08-22T10:02:00Z' },
];


function renderQueue(props: Partial<Parameters<typeof PromptQueue>[0]> = {}) {
  const onSteer = vi.fn(async () => {});
  const onRemove = vi.fn(async () => {});
  render(<PromptQueue items={items} active busy={false} onSteer={onSteer} onRemove={onRemove} {...props} />);
  return { onSteer, onRemove };
}


describe('PromptQueue', () => {
  it('shows persisted queued work and lets the user steer with it or remove it', () => {
    const { onSteer, onRemove } = renderQueue();

    expect(screen.getByText('Run Windows tests')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Steer with queued instruction 1' }));
    expect(onSteer).toHaveBeenCalledWith('queued-1');
    fireEvent.click(screen.getByRole('button', { name: 'Remove queued instruction 2' }));
    expect(onRemove).toHaveBeenCalledWith('queued-2');
  });

  it('keeps queued work removable but not steerable while the turn cannot take a steer', () => {
    renderQueue({ active: false });

    expect(screen.queryByRole('button', { name: /Steer with queued instruction/ })).toBeNull();
    expect(screen.getByRole('button', { name: 'Remove queued instruction 1' })).toBeEnabled();
  });

  it('offers the notices waiting behind it once, on the first row', () => {
    const onShowMore = vi.fn();
    renderQueue({ more: 2, onShowMore });

    fireEvent.click(screen.getByRole('button', { name: 'Show 2 more notices' }));
    expect(onShowMore).toHaveBeenCalledOnce();
    expect(screen.getAllByRole('button', { name: /more notice/ })).toHaveLength(1);
  });

  it('renders nothing with no queued work', () => {
    const { container } = render(<PromptQueue items={[]} active busy={false} onSteer={vi.fn()} onRemove={vi.fn()} />);
    expect(container).toBeEmptyDOMElement();
  });
});
