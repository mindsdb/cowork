import { describe, it, expect, vi } from 'vitest';
import { useState } from 'react';
import { render, screen, waitFor, within, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const hostSpies = vi.hoisted(() => ({ openExternal: vi.fn() }));
vi.mock('../../platform/host', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, host: { ...actual.host, openExternal: hostSpies.openExternal } };
});

const analyticsSpies = vi.hoisted(() => ({ trackBillingOpened: vi.fn() }));
vi.mock('../lib/analytics', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, trackBillingOpened: analyticsSpies.trackBillingOpened };
});

import { ModelSelect } from './ModelSelect';
import { MINDS_BILLING_URL } from '../../lib/mindsUrls';

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
    // Wide provider marks must keep their width footprint without square-box letterboxing.
    // ProviderIcon.test.jsx covers aspect sizing and the no-manual-nudge contract.
    render(<Harness />); // default initial = 'mindshub_air'
    const svg = screen.getByRole('combobox').querySelector('svg');
    expect(svg).toHaveAttribute('width', '15'); // same footprint as every other icon
    expect(Number(svg.getAttribute('height'))).toBeLessThan(15);
  });

  it('applies no manual nudge to the trigger\'s icon — auto-centering handles alignment', () => {
    // ProviderIcon crops to each mark's ink bounds; the trigger needs no blanket nudgeY.
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

  it('can identify the open model menu without adding text to the closed trigger', async () => {
    const user = userEvent.setup();
    render(<Harness menuLabel="Model" ariaLabel="Choose model" />);

    expect(screen.getByRole('combobox', { name: 'Choose model' })).not.toHaveTextContent('Model');
    await user.click(screen.getByRole('combobox', { name: 'Choose model' }));

    expect(screen.getByText('Model')).toBeInTheDocument();
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

  // A tag alone does not disable selection; disabled and locked are separate option fields.
  it('fires onValueChange for a tagged option that is not disabled', async () => {
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

// The Add credits button remains actionable on an otherwise disabled row and is shared by both
// pickers.
describe('ModelSelect — the route to credits on a locked row', () => {
  const LOCKED = [
    { value: 'mindshub_air', label: 'MindsHub Air' },
    { value: 'opus', label: 'Claude Opus 5', tag: 'Needs credits', disabled: true, locked: true },
  ];

  it('puts an Add credits button on a locked row and opens billing from it', async () => {
    const user = userEvent.setup();
    hostSpies.openExternal.mockClear();
    analyticsSpies.trackBillingOpened.mockClear();
    const onValueChange = vi.fn();
    render(<Harness options={LOCKED} onValueChange={onValueChange} />);

    await user.click(screen.getByRole('combobox'));
    const row = screen.getByRole('option', { name: /Claude Opus 5/ });
    await user.click(within(row).getByRole('button', { name: 'Add credits' }));

    expect(hostSpies.openExternal).toHaveBeenCalledWith(MINDS_BILLING_URL);
    // Its own trigger, distinct from the no-credits notice and the top-up hint,
    // so the three are not read as one in the funnel.
    expect(analyticsSpies.trackBillingOpened).toHaveBeenCalledWith('locked_model_row');
    // Holds because the row is disabled, NOT because of the button's
    // stopPropagation — strip that and this still passes.
    expect(onValueChange).not.toHaveBeenCalled();
  });

  it('leaves an affordable row without one', async () => {
    const user = userEvent.setup();
    render(<Harness options={LOCKED} />);

    await user.click(screen.getByRole('combobox'));
    const row = screen.getByRole('option', { name: 'MindsHub Air' });
    expect(within(row).queryByRole('button', { name: 'Add credits' })).toBeNull();
  });

  // Model Router carries its own action and is never locked; this pins that a
  // call site's action is never silently replaced if that ever changes.
  it('does not overwrite an action the call site already set', async () => {
    const user = userEvent.setup();
    render(<Harness options={[
      { value: 'opus', label: 'Claude Opus 5', disabled: true, locked: true,
        action: <button type="button">Router Settings</button> },
    ]} initial="opus" />);

    await user.click(screen.getByRole('combobox'));
    const row = screen.getByRole('option', { name: /Claude Opus 5/ });
    expect(within(row).getByRole('button', { name: 'Router Settings' })).toBeInTheDocument();
    expect(within(row).queryByRole('button', { name: 'Add credits' })).toBeNull();
  });
});

// The reasoning-effort footer shares the model popup.
describe('ModelSelect — reasoning-effort footer (ENG-1940)', () => {
  const MODEL_EFFORTS = {
    sonnet: { efforts: ['low', 'medium', 'high'], default: 'medium' },
    opus: { efforts: ['low', 'high'], default: 'high' },
  };

  it('renders no footer at all for a model with no modelEfforts entry', async () => {
    const user = userEvent.setup();
    render(<Harness initial="mindshub_air" modelEfforts={MODEL_EFFORTS} effort="" onEffortChange={vi.fn()} />);

    await user.click(screen.getByRole('combobox'));

    expect(screen.queryByText('Effort')).not.toBeInTheDocument();
  });

  it('shows the resolved effort label in the footer for a model with an entry', async () => {
    const user = userEvent.setup();
    render(<Harness initial="sonnet" modelEfforts={MODEL_EFFORTS} effort="high" onEffortChange={vi.fn()} />);

    await user.click(screen.getByRole('combobox'));

    const footerRow = screen.getByText('Effort').parentElement;
    expect(within(footerRow).getByText('High')).toBeInTheDocument();
  });

  it('falls back to the entry default when the current value is not one of the model\'s options', async () => {
    const user = userEvent.setup();
    render(<Harness initial="sonnet" modelEfforts={MODEL_EFFORTS} effort="ultra" onEffortChange={vi.fn()} />);

    await user.click(screen.getByRole('combobox'));

    const footerRow = screen.getByText('Effort').parentElement;
    expect(within(footerRow).getByText('Medium')).toBeInTheDocument();
  });

  it('opens a flyout on hover showing every level with a checkmark on the current value and a Default tag on the model default', async () => {
    const user = userEvent.setup();
    // Use an effort different from the default to distinguish the current checkmark from the
    // Default tag.
    render(<Harness initial="sonnet" modelEfforts={MODEL_EFFORTS} effort="high" onEffortChange={vi.fn()} />);

    await user.click(screen.getByRole('combobox'));
    fireEvent.mouseEnter(screen.getByText('Effort').closest('button'));

    const panel = screen.getByText(/Higher effort means more thorough responses/).parentElement;
    const lowRow = within(panel).getByText('Low').closest('button');
    const mediumRow = within(panel).getByText('Medium').closest('button');
    const highRow = within(panel).getByText('High').closest('button');

    expect(within(mediumRow).getByText('Default')).toBeInTheDocument();
    expect(within(highRow).queryByText('Default')).toBeNull();
    expect(within(lowRow).queryByText('Default')).toBeNull();
    // The checkmark (a bare svg, no text) lands only on the current value.
    expect(highRow.querySelector('svg')).toBeTruthy();
    expect(mediumRow.querySelector('svg')).toBeFalsy();
    expect(lowRow.querySelector('svg')).toBeFalsy();
  });

  it('clicking a level fires onEffortChange and closes the flyout and the model popup', async () => {
    const user = userEvent.setup();
    const onEffortChange = vi.fn();
    render(<Harness initial="sonnet" modelEfforts={MODEL_EFFORTS} effort="medium" onEffortChange={onEffortChange} />);

    await user.click(screen.getByRole('combobox'));
    fireEvent.mouseEnter(screen.getByText('Effort').closest('button'));
    const panel = screen.getByText(/Higher effort means more thorough responses/).parentElement;
    const highRow = within(panel).getByText('High').closest('button');
    await user.click(highRow);

    expect(onEffortChange).toHaveBeenCalledWith('high');
    expect(screen.queryByText(/Higher effort means more thorough responses/)).not.toBeInTheDocument();
    expect(screen.queryByRole('option')).not.toBeInTheDocument();
  });

  it('does not render the footer for harness="hermes", even for a model with effort options', async () => {
    const user = userEvent.setup();
    render(<Harness initial="sonnet" modelEfforts={MODEL_EFFORTS} effort="" onEffortChange={vi.fn()} harness="hermes" />);

    await user.click(screen.getByRole('combobox'));

    expect(screen.queryByText('Effort')).not.toBeInTheDocument();
  });

  it('does not render the footer at all when no model is selected', async () => {
    const user = userEvent.setup();
    render(<Harness initial="" modelEfforts={MODEL_EFFORTS} effort="" onEffortChange={vi.fn()} />);

    await user.click(screen.getByRole('combobox'));

    expect(screen.queryByText('Effort')).not.toBeInTheDocument();
  });

  it('does not open the flyout without a hover — the footer renders closed', async () => {
    const user = userEvent.setup();
    render(<Harness initial="sonnet" modelEfforts={MODEL_EFFORTS} effort="" onEffortChange={vi.fn()} />);

    await user.click(screen.getByRole('combobox'));

    expect(screen.getByText('Effort')).toBeInTheDocument();
    expect(screen.queryByText(/Higher effort means more thorough responses/)).not.toBeInTheDocument();
  });

  // Use a stateful parent to exercise Base UI's actual item-press close; ModelSelect must veto it
  // when the new model offers effort options.
  function StatefulHarness({ initial, ...rest }) {
    const [value, setValue] = useState(initial);
    return <Harness initial={value} onValueChange={setValue} {...rest} />;
  }

  it('clicking a model row with effort options keeps the popup open with the footer shown (flyout stays closed)', async () => {
    const user = userEvent.setup();
    render(<StatefulHarness initial="mindshub_air" modelEfforts={MODEL_EFFORTS} effort="" onEffortChange={vi.fn()} />);

    await user.click(screen.getByRole('combobox'));
    await user.click(screen.getByRole('option', { name: 'Claude Sonnet 5' }));

    // Still open: the list is still there, and the footer has appeared —
    // but its flyout has NOT opened by itself (hover does that).
    expect(screen.getByRole('option', { name: 'Claude Sonnet 5' })).toBeInTheDocument();
    expect(screen.getByText('Effort')).toBeInTheDocument();
    expect(screen.queryByText(/Higher effort means more thorough responses/)).not.toBeInTheDocument();
  });

  it('picking a no-effort model with the footer up fades the footer out, then closes the popup', async () => {
    // Allow the footer exit animation before closing the popup for a model without effort options.
    const user = userEvent.setup();
    render(<StatefulHarness initial="sonnet" modelEfforts={MODEL_EFFORTS} effort="" onEffortChange={vi.fn()} />);

    await user.click(screen.getByRole('combobox'));
    expect(screen.getByText('Effort')).toBeInTheDocument();
    await user.click(screen.getByRole('option', { name: 'MindsHub Air' }));

    // Immediately after the pick: still open, outgoing footer still visible
    // (playing its fade-out).
    expect(screen.getByRole('option', { name: 'MindsHub Air' })).toBeInTheDocument();
    expect(screen.getByText('Effort')).toBeInTheDocument();

    await waitFor(() => expect(screen.queryByRole('option')).not.toBeInTheDocument());
  });

  it('picking a no-effort model with no footer showing closes the popup immediately', async () => {
    const user = userEvent.setup();
    // gpt-codex has no modelEfforts entry either — no footer at open, so no
    // exit to play; the pick closes the popup as it always did.
    render(<StatefulHarness initial="gpt-codex" modelEfforts={MODEL_EFFORTS} effort="" onEffortChange={vi.fn()} />);

    await user.click(screen.getByRole('combobox'));
    expect(screen.queryByText('Effort')).not.toBeInTheDocument();
    await user.click(screen.getByRole('option', { name: 'MindsHub Air' }));

    expect(screen.queryByRole('option')).not.toBeInTheDocument();
  });

  it('relabels the trigger immediately on an effort-model pick, while the popup stays open', async () => {
    // The trigger must update during selection while the popup stays anchored.
    // jsdom cannot assert the width animation because offsetWidth is zero.
    const user = userEvent.setup();
    // ariaLabel disambiguates the trigger from the open popup's search input,
    // which Base UI also exposes with role="combobox".
    render(
      <StatefulHarness
        initial="mindshub_air"
        modelEfforts={MODEL_EFFORTS}
        effort=""
        onEffortChange={vi.fn()}
        ariaLabel="Choose model"
      />,
    );

    await user.click(screen.getByRole('combobox', { name: 'Choose model' }));
    await user.click(screen.getByRole('option', { name: 'Claude Sonnet 5' }));

    expect(screen.getByRole('option', { name: 'Claude Sonnet 5' })).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Choose model' })).toHaveTextContent('Claude Sonnet 5');
    expect(screen.getByRole('combobox', { name: 'Choose model' })).not.toHaveTextContent('MindsHub Air');
  });

  it('appends the effort label to the trigger, muted, whenever one is explicitly picked — the model default included', () => {
    // An explicit default-level choice must still show its suffix so the selection appears to
    // register.
    const { rerender } = render(
      <Harness initial="sonnet" modelEfforts={MODEL_EFFORTS} effort="high" onEffortChange={vi.fn()} />,
    );
    expect(screen.getByRole('combobox')).toHaveTextContent('Claude Sonnet 5 · High');

    rerender(
      <Harness initial="sonnet" modelEfforts={MODEL_EFFORTS} effort="medium" onEffortChange={vi.fn()} />,
    );
    // "medium" IS sonnet's own default — an explicit pick still shows.
    expect(screen.getByRole('combobox')).toHaveTextContent('Claude Sonnet 5 · Medium');
  });

  it('shows just the model name while no effort has been explicitly picked', () => {
    // effort='' — resolution silently falls back to the model's default, but
    // an untouched setting doesn't clutter the trigger.
    render(<Harness initial="sonnet" modelEfforts={MODEL_EFFORTS} effort="" onEffortChange={vi.fn()} />);
    expect(screen.getByRole('combobox')).toHaveTextContent('Claude Sonnet 5');
    expect(screen.getByRole('combobox')).not.toHaveTextContent('·');
  });

  it('drops the trigger suffix when the picked effort is not valid for the current model', () => {
    // An unsupported effort falls back to the new model's default; do not display a level that will
    // not be sent.
    render(<Harness initial="opus" modelEfforts={MODEL_EFFORTS} effort="medium" onEffortChange={vi.fn()} />);
    expect(screen.getByRole('combobox')).toHaveTextContent('Claude Opus 5');
    expect(screen.getByRole('combobox')).not.toHaveTextContent('·');
  });

  it('shows just the model name when modelEfforts was not passed at all (regression)', () => {
    render(<Harness initial="sonnet" effort="high" />);
    expect(screen.getByRole('combobox')).toHaveTextContent('Claude Sonnet 5');
  });
});
