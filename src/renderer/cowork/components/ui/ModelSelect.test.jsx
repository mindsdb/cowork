import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ModelSelect } from './ModelSelect';

const OPTIONS = [
  { value: 'mindshub_air', label: 'MindsHub Air' },
  { value: 'gpt-codex', label: 'GPT 5.3 Codex' },
  { value: 'sonnet', label: 'Claude Sonnet 5' },
  { value: 'opus', label: 'Claude Opus 5 — Add credits to unlock', disabled: true },
  { value: '__custom__', label: 'Other…', pin: 'bottom' },
];

function Harness({ initial = 'mindshub_air', options = OPTIONS, ...rest }) {
  const onValueChange = rest.onValueChange || vi.fn();
  return <ModelSelect value={initial} onValueChange={onValueChange} options={options} {...rest} />;
}

describe('ModelSelect', () => {
  it('shows the selected model label on the closed trigger', () => {
    render(<Harness />);
    expect(screen.getByRole('combobox')).toHaveTextContent('MindsHub Air');
  });

  it('opens on click with provider group headers and a focused search input', async () => {
    const user = userEvent.setup();
    render(<Harness />);

    await user.click(screen.getByRole('combobox'));

    expect(screen.getByText('MindsHub')).toBeInTheDocument();
    expect(screen.getByText('OpenAI')).toBeInTheDocument();
    expect(screen.getByText('Anthropic')).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Claude Sonnet 5' })).toBeInTheDocument();
    // Base UI moves focus into the popup input a tick after it opens.
    await waitFor(() => expect(screen.getByLabelText('Search models')).toHaveFocus());
  });

  it('marks the current model as selected', async () => {
    const user = userEvent.setup();
    render(<Harness initial="sonnet" />);

    await user.click(screen.getByRole('combobox'));

    expect(screen.getByRole('option', { name: 'Claude Sonnet 5' }))
      .toHaveAttribute('aria-selected', 'true');
  });

  it('fires onValueChange with the picked id string, not the item object', async () => {
    const user = userEvent.setup();
    const onValueChange = vi.fn();
    render(<Harness onValueChange={onValueChange} />);

    await user.click(screen.getByRole('combobox'));
    await user.click(screen.getByRole('option', { name: 'GPT 5.3 Codex' }));

    expect(onValueChange).toHaveBeenCalledTimes(1);
    expect(onValueChange).toHaveBeenCalledWith('gpt-codex');
  });

  it('does not fire onValueChange for a locked (disabled) model', async () => {
    const user = userEvent.setup();
    const onValueChange = vi.fn();
    render(<Harness onValueChange={onValueChange} />);

    await user.click(screen.getByRole('combobox'));
    await user.click(screen.getByRole('option', { name: /Add credits to unlock/ }));

    expect(onValueChange).not.toHaveBeenCalled();
  });

  it('filters across every group and hides groups with no matches', async () => {
    const user = userEvent.setup();
    render(<Harness />);

    await user.click(screen.getByRole('combobox'));
    await user.keyboard('sonnet');

    expect(screen.getByRole('option', { name: 'Claude Sonnet 5' })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: 'GPT 5.3 Codex' })).not.toBeInTheDocument();
    expect(screen.getByText('Anthropic')).toBeInTheDocument();
    expect(screen.queryByText('OpenAI')).not.toBeInTheDocument();
  });

  it('matches on the raw id as well as the label', async () => {
    const user = userEvent.setup();
    render(<Harness />);

    await user.click(screen.getByRole('combobox'));
    await user.keyboard('gpt-codex');

    expect(screen.getByRole('option', { name: 'GPT 5.3 Codex' })).toBeInTheDocument();
  });

  it('shows the no-results message when nothing matches', async () => {
    const user = userEvent.setup();
    render(<Harness options={OPTIONS.filter((o) => !o.pin)} />);

    await user.click(screen.getByRole('combobox'));
    await user.keyboard('zzzz');

    expect(screen.getByText('No models found')).toBeInTheDocument();
    expect(screen.queryAllByRole('option')).toHaveLength(0);
  });

  it('keeps pinned entries visible while searching (Other… escape hatch)', async () => {
    const user = userEvent.setup();
    render(<Harness />);

    await user.click(screen.getByRole('combobox'));
    await user.keyboard('zzzz');

    expect(screen.getByRole('option', { name: 'Other…' })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: 'Claude Sonnet 5' })).not.toBeInTheDocument();
  });

  it('renders pinned entries without a group header', async () => {
    const user = userEvent.setup();
    render(<Harness />);

    await user.click(screen.getByRole('combobox'));

    expect(screen.getByRole('option', { name: 'Other…' })).toBeInTheDocument();
    expect(screen.queryByText('Other')).not.toBeInTheDocument();
  });

  it('still shows a label on the trigger when the value is missing from options', () => {
    render(<Harness initial="ghost-model" />);
    expect(screen.getByRole('combobox')).toHaveTextContent('ghost-model');
  });

  it('shows the placeholder when no value is selected', () => {
    render(<Harness initial="" placeholder="Select model" />);
    expect(screen.getByRole('combobox')).toHaveTextContent('Select model');
  });
});
