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
