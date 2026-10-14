import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { ThinkingBlock } from './ThinkingBlock';

describe('ThinkingBlock', () => {
  it('shows a live thought before the first tool step arrives', () => {
    render(
      <ThinkingBlock
        isActive
        currentThought={{ text: 'Checking the latest information.', startedAt: 1000 }}
      />
    );

    expect(screen.getByText('Checking the latest information.')).toBeVisible();
  });

  it('keeps a completed block collapsed when it has inspectable steps', () => {
    render(
      <ThinkingBlock
        steps={[{
          id: 'tool-1',
          label: 'Search the docs',
          status: 'completed',
          _isToolCall: true,
        }]}
      />
    );

    expect(screen.queryByText('Search the docs')).not.toBeInTheDocument();
  });

  it('auto-expands a live block that holds only ToolProgress rows (ENG-2981)', () => {
    // The block that appears below an answered question starts with just
    // the pipeline's step lines; they must be visible without a click.
    render(
      <ThinkingBlock
        isActive
        startedAt={1000}
        steps={[{
          id: 'step-5',
          label: 'Writing the page (step 3 of 4)',
          badge: 'ToolProgress',
          status: 'in_progress',
          startedAt: 1000,
          _scratchpadTabId: 'tc_1',
        }]}
      />
    );

    expect(screen.getByText('Writing the page (step 3 of 4)')).toBeVisible();
  });

  /* A silent model call shows the server's model-wait status. The live block
   * auto-expands on it, so each case collapses the block first: the collapsed
   * header is the only place a user who folded the steps away still sees it. */
  const collapsedHeader = () => {
    const header = screen.getByRole('button');
    if (header.getAttribute('aria-expanded') === 'true') fireEvent.click(header);
    expect(header).toHaveAttribute('aria-expanded', 'false');
    return header;
  };

  it('adds the model-wait status to the collapsed header, after the step label', () => {
    render(
      <ThinkingBlock
        isActive
        startedAt={1000}
        currentLabel="Running code"
        currentThought={{ text: 'Waiting for the model (1m 0s)', startedAt: 1000, kind: 'model_wait' }}
      />
    );

    expect(collapsedHeader()).toHaveTextContent(/^Running code · Waiting for the model \(1m 0s\)$/);
  });

  it('adds the model-wait status after the default label when no step is running', () => {
    render(
      <ThinkingBlock
        isActive
        startedAt={1000}
        currentThought={{ text: 'Waiting for the model (1m 0s)', startedAt: 1000, kind: 'model_wait' }}
      />
    );

    expect(collapsedHeader()).toHaveTextContent(/^Thinking… · Waiting for the model \(1m 0s\)$/);
  });

  it('shows the wait line in the open block, and stays closed through later ticks once folded', () => {
    /* Ticks arrive every 20 to 25 s. The first opens the live block like a
     * reasoning burst does; after the user folds it, later ticks, and a tick
     * after the line was cleared by a tool frame, must leave it folded while
     * the header keeps the newest wait. */
    const tick = (text, startedAt) => ({ text, startedAt, kind: 'model_wait' });
    const block = (thought) => (
      <ThinkingBlock isActive startedAt={1000} currentThought={thought} />
    );
    // Mounted empty, as a live turn starts, so the tick opens it through the
    // auto-expand effect rather than the initial state.
    const { rerender } = render(block(null));
    const header = screen.getByRole('button');
    expect(header).toHaveAttribute('aria-expanded', 'false');

    rerender(block(tick('Waiting for the model (20s)', 1000)));
    expect(header).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText('Waiting for the model (20s)')).toBeVisible();
    expect(header).toHaveTextContent(/^Working for /);
    expect(header).not.toHaveTextContent(/Waiting/);

    fireEvent.click(header);
    rerender(block(tick('Waiting for the model (40s)', 21000)));
    expect(header).toHaveAttribute('aria-expanded', 'false');
    expect(header).toHaveTextContent(/^Thinking… · Waiting for the model \(40s\)$/);

    rerender(block(null));
    rerender(block(tick('Waiting for the model (1m 0s)', 41000)));
    expect(header).toHaveAttribute('aria-expanded', 'false');
    expect(header).toHaveTextContent(/^Thinking… · Waiting for the model \(1m 0s\)$/);
  });

  it('keeps the model\'s own reasoning out of the collapsed header', () => {
    render(
      <ThinkingBlock
        isActive
        startedAt={1000}
        currentLabel="Running code"
        currentThought={{ text: 'Checking the latest information.', startedAt: 1000 }}
      />
    );

    expect(collapsedHeader()).toHaveTextContent(/^Running code$/);
  });
});
