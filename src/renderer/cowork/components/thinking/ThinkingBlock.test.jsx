import { describe, expect, it, vi } from 'vitest';
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

describe('ThinkingBlock object and plain rows', () => {
  const skill = { id: 'skill-digest', label: 'Weekly metrics digest', badge: 'Skill', status: 'completed', startedAt: 1000, completedAt: 1000 };
  const artifact = { id: 'artifact-dash', label: 'Signups dashboard', badge: 'Artifact', status: 'completed', startedAt: 9000, completedAt: 9000 };
  const cell = { id: 'step-1', label: 'Load signups.csv', status: 'completed', startedAt: 1000, completedAt: 5000, _isScratchpad: true };
  const memory = { id: 'step-2', label: 'Saving to memory: Prefers weekly buckets', badge: 'Memory', status: 'completed', startedAt: 5000, completedAt: 6000 };

  // A skill-draft turn's only step is the skill, and the card under the answer
  // already shows it: the fold above the answer held nothing else.
  it('renders nothing for a finished block of object rows only', () => {
    const { container } = render(<ThinkingBlock steps={[skill]} startedAt={1000} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('still shows the object row beside real work', async () => {
    render(<ThinkingBlock steps={[cell, artifact]} startedAt={1000} />);
    fireEvent.click(screen.getByRole('button'));
    expect(screen.getByText('Signups dashboard')).toBeVisible();
  });

  it('hands object and scratchpad rows to onActivateStep, and leaves memory rows inert', () => {
    const onActivateStep = vi.fn();
    render(<ThinkingBlock steps={[cell, memory, artifact]} startedAt={1000} onActivateStep={onActivateStep} />);
    fireEvent.click(screen.getByRole('button'));

    fireEvent.click(screen.getByText('Signups dashboard'));
    fireEvent.click(screen.getByText('Load signups.csv'));
    fireEvent.click(screen.getByText('Saving to memory: Prefers weekly buckets'));

    expect(onActivateStep.mock.calls.map(([step]) => step.id)).toEqual(['artifact-dash', 'step-1']);
  });
});
