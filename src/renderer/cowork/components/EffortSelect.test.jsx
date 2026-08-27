// EffortSelect (ENG-1940) — the reasoning-effort sub-picker that sits
// beside ModelSelect in the composer toolbar. Covers, in isolation:
//   - it renders nothing when the current model has no `modelEfforts`
//     entry, or when the active harness is Hermes (no effort knob there)
//   - a pick round-trips through onValueChange with the raw effort string
//   - the value resolves to the entry's default when the current value
//     isn't one of the model's own options
//   - autoOpenKey changing to a model WITH effort options opens the
//     popup; an unchanged key, or the initial mount, does not
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { EffortSelect } from './EffortSelect';

const MODEL_EFFORTS = {
  sonnet: { efforts: ['low', 'medium', 'high'], default: 'medium' },
  opus: { efforts: ['low', 'high'], default: 'high' },
};

describe('EffortSelect — visibility (ENG-1940)', () => {
  it('renders nothing when the current model has no modelEfforts entry', () => {
    render(
      <EffortSelect modelId="kimi" modelEfforts={MODEL_EFFORTS} value="" onValueChange={vi.fn()} />,
    );
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
  });

  it('renders nothing when modelEfforts is entirely absent', () => {
    render(<EffortSelect modelId="sonnet" value="" onValueChange={vi.fn()} />);
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
  });

  it('renders nothing when the active harness is Hermes, even for a model with effort options', () => {
    render(
      <EffortSelect
        modelId="sonnet"
        modelEfforts={MODEL_EFFORTS}
        harness="hermes"
        value=""
        onValueChange={vi.fn()}
      />,
    );
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
  });

  it('renders for a model with effort options when harness is anton (or unset)', () => {
    render(
      <EffortSelect modelId="sonnet" modelEfforts={MODEL_EFFORTS} value="" onValueChange={vi.fn()} />,
    );
    expect(screen.getByRole('combobox', { name: 'Reasoning effort' })).toBeInTheDocument();
  });
});

describe('EffortSelect — value resolution and picking', () => {
  it('falls back to the entry default when the current value is not one of the model\'s options', () => {
    render(
      <EffortSelect modelId="sonnet" modelEfforts={MODEL_EFFORTS} value="ultra" onValueChange={vi.fn()} />,
    );
    expect(screen.getByRole('combobox', { name: 'Reasoning effort' })).toHaveTextContent('Medium');
  });

  it('shows the current value when it is one of the model\'s own options', () => {
    render(
      <EffortSelect modelId="opus" modelEfforts={MODEL_EFFORTS} value="low" onValueChange={vi.fn()} />,
    );
    expect(screen.getByRole('combobox', { name: 'Reasoning effort' })).toHaveTextContent('Low');
  });

  it('fires onValueChange with the picked effort string', async () => {
    const user = userEvent.setup();
    const onValueChange = vi.fn();
    render(
      <EffortSelect modelId="sonnet" modelEfforts={MODEL_EFFORTS} value="medium" onValueChange={onValueChange} />,
    );

    await user.click(screen.getByRole('combobox', { name: 'Reasoning effort' }));
    await user.click(screen.getByRole('option', { name: 'High' }));

    expect(onValueChange).toHaveBeenCalledWith('high');
  });
});

describe('EffortSelect — auto-open on model switch (ENG-1940)', () => {
  it('does not auto-open on initial mount, even for a model that already has effort options', () => {
    render(
      <EffortSelect
        modelId="sonnet"
        modelEfforts={MODEL_EFFORTS}
        value=""
        onValueChange={vi.fn()}
        autoOpenKey="sonnet"
      />,
    );
    expect(screen.queryByRole('option')).not.toBeInTheDocument();
  });

  it('opens when autoOpenKey changes to a model with effort options', () => {
    const { rerender } = render(
      <EffortSelect modelId="kimi" modelEfforts={MODEL_EFFORTS} value="" onValueChange={vi.fn()} autoOpenKey="kimi" />,
    );
    expect(screen.queryByRole('option')).not.toBeInTheDocument();

    rerender(
      <EffortSelect modelId="sonnet" modelEfforts={MODEL_EFFORTS} value="" onValueChange={vi.fn()} autoOpenKey="sonnet" />,
    );

    expect(screen.getByRole('option', { name: 'Low' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Medium' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'High' })).toBeInTheDocument();
  });

  it('does not re-open when autoOpenKey is set to the same value again', () => {
    const { rerender } = render(
      <EffortSelect modelId="sonnet" modelEfforts={MODEL_EFFORTS} value="" onValueChange={vi.fn()} autoOpenKey="sonnet" />,
    );
    rerender(
      <EffortSelect modelId="sonnet" modelEfforts={MODEL_EFFORTS} value="" onValueChange={vi.fn()} autoOpenKey="sonnet" />,
    );
    expect(screen.queryByRole('option')).not.toBeInTheDocument();
  });
});
