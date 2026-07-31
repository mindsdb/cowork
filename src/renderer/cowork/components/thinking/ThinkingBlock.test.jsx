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
});
