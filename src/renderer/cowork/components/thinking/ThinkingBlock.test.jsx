import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
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
});
