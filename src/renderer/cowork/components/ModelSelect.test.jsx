import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ModelSelect } from './ModelSelect';

const OPTIONS = [
  { value: 'mindshub_air', label: 'MindsHub Air' },
  { value: 'gpt-codex', label: 'GPT 5.3 Codex' },
  { value: 'sonnet', label: 'Claude Sonnet 5' },
  { value: 'opus', label: 'Claude Opus 5', tag: 'Needs credits' },
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

  it('shrinks the mindshub mark\'s height to its true aspect ratio, keeping the same width as every icon', () => {
    // Regression: squeezing the bear's markedly-wide viewBox (517x287) into
    // the same size x size box as every square provider mark letterboxed it
    // (empty vertical padding to fit the width), unbalancing the glyph
    // within its box in a way translateY nudging can't actually fix — the
    // padding itself is what's asymmetric, not the glyph's position. Widening
    // the box instead (rather than shrinking its height) was tried and
    // rejected — it grew the icon's footprint next to the fixed flex gap,
    // making the gap to the label look oversized. See ProviderIcon.test.jsx
    // for the full measure/aspect-ratio/no-manual-nudge coverage.
    render(<Harness />); // default initial = 'mindshub_air'
    const svg = screen.getByRole('combobox').querySelector('svg');
    expect(svg).toHaveAttribute('width', '15'); // same footprint as every other icon
    expect(Number(svg.getAttribute('height'))).toBeLessThan(15);
  });

  it('applies no manual nudge to the trigger\'s icon — auto-centering handles alignment', () => {
    // ProviderIcon measures every mark's true ink bounding box and crops to
    // it, so the trigger no longer needs (or passes) a blanket nudgeY.
    render(<Harness />);
    const svg = screen.getByRole('combobox').querySelector('svg');
    expect(svg.style.transform).toBe('');
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

  // ENG-1248: needs-credits models are selectable — the wall moved from the
  // picker row (a silent no-op) to use time, where a top-up route exists.
  it('fires onValueChange for a needs-credits model and shows its tag', async () => {
    const user = userEvent.setup();
    const onValueChange = vi.fn();
    render(<Harness onValueChange={onValueChange} />);

    await user.click(screen.getByRole('combobox'));
    const row = screen.getByRole('option', { name: /Claude Opus 5/ });
    expect(row).toHaveTextContent('Needs credits');
    await user.click(row);

    expect(onValueChange).toHaveBeenCalledWith('opus');
  });

  it('still matches a tagged model when searching its bare name', async () => {
    const user = userEvent.setup();
    render(<Harness />);

    await user.click(screen.getByRole('combobox'));
    await user.keyboard('opus');

    expect(screen.getByRole('option', { name: /Claude Opus 5/ })).toBeInTheDocument();
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

  it('renders a row tag as its own pill, which the search does not match', async () => {
    const user = userEvent.setup();
    render(<Harness initial="sonnet" options={[
      { value: 'sonnet', label: 'Claude Sonnet 5', tag: 'Latest' },
      { value: 'sonnet-4-5', label: 'Claude Sonnet 4.5', tag: 'Older version' },
    ]} />);

    await user.click(screen.getByRole('combobox'));
    expect(screen.getByText('Latest')).toBeInTheDocument();
    expect(screen.getByText('Older version')).toBeInTheDocument();

    // The pill is not part of what the filter reads, so a marker can't stand in for
    // a model name: typing one matches nothing rather than every tagged row.
    await user.keyboard('Latest');
    expect(screen.queryAllByRole('option')).toHaveLength(0);
  });

  it('keeps a row tag off the closed trigger', () => {
    // The trigger is fixed-width and renders the selected label verbatim, which is
    // why the marker is a row pill and never a label suffix.
    render(<Harness initial="sonnet" options={[{ value: 'sonnet', label: 'Claude Sonnet 5', tag: 'Latest' }]} />);
    expect(screen.getByRole('combobox')).toHaveTextContent('Claude Sonnet 5');
    expect(screen.getByRole('combobox')).not.toHaveTextContent('Latest');
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
