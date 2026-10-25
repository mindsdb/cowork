import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../lib/deployment', () => ({ PLATFORM_UI: false }));
vi.mock('../api', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, fetchSkills: vi.fn(async () => ({ skills: [] })) };
});

import Composer from './Composer';
import { MODEL_ROUTER, MODEL_ROUTER_ID } from '../lib/modelCatalog';

const luna = { id: 'gpt-5.6-luna', name: 'GPT 5.6 Luna' };
const opus = { id: 'opus-5-5', name: 'Opus 5.5' };
const hidden = { id: 'gpt-luna-5-6', name: 'GPT Luna 5.6' };
const modelMeta = {
  modelEnabled: { [luna.id]: true, [opus.id]: true, [hidden.id]: false },
  modelEfforts: { [opus.id]: { efforts: ['high', 'xhigh'] } },
};

function renderComposer(props = {}) {
  const onModelChange = vi.fn();
  render(<Composer
    onSend={vi.fn()}
    projects={[]}
    models={[luna, opus, hidden]}
    model={MODEL_ROUTER}
    modelMeta={modelMeta}
    effort="high"
    onModelChange={onModelChange}
    onEffortChange={vi.fn()}
    onOpenSettings={vi.fn()}
    {...props}
  />);
  return { onModelChange };
}

beforeEach(() => {
  const meta = document.createElement('meta');
  meta.name = 'cowork-model-picker';
  meta.content = 'default';
  document.head.append(meta);
});

afterEach(() => {
  document.head.querySelectorAll('meta[name="cowork-model-picker"]').forEach((node) => node.remove());
});

describe("the operator's model picker with platform UI off", () => {
  it("lists the operator's model first, then only the offered models, with no effort control", async () => {
    const user = userEvent.setup();
    renderComposer();

    const picker = screen.getByRole('combobox', { name: 'Choose model' });
    expect(picker).toHaveTextContent('Operator default');
    await user.click(picker);
    const rows = screen.getAllByRole('option').map((row) => row.textContent);
    expect(rows[0]).toContain('Operator default');
    expect(rows.slice(1).join('|')).toContain(luna.name);
    expect(rows.slice(1).join('|')).toContain(opus.name);
    expect(rows.join('|')).not.toContain(hidden.name);
    expect(screen.queryByText('MindsHub')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Router Settings' })).not.toBeInTheDocument();
    expect(screen.queryByRole('combobox', { name: 'Reasoning effort' })).not.toBeInTheDocument();
  });

  it('hands a pick to the caller', async () => {
    const user = userEvent.setup();
    const { onModelChange } = renderComposer();
    await user.click(screen.getByRole('combobox', { name: 'Choose model' }));
    await user.click(screen.getByRole('option', { name: opus.name }));
    expect(onModelChange).toHaveBeenCalledWith({ id: opus.id, name: opus.name });
  });

  it('keeps no effort control for a picked model that advertises effort levels', () => {
    renderComposer({ model: opus });
    expect(screen.getByRole('combobox', { name: 'Choose model' })).toHaveTextContent(opus.name);
    expect(screen.queryByRole('combobox', { name: 'Reasoning effort' })).not.toBeInTheDocument();
  });

  it("shows a model the picker no longer offers as the operator's own", () => {
    renderComposer({ model: hidden });
    expect(screen.getByRole('combobox', { name: 'Choose model' })).toHaveTextContent('Operator default');
  });

  it.each([
    ['an empty catalog', []],
    ['a catalog that offers nothing', [hidden]],
  ])('shows no picker and no settings shortcut for %s', (_name, models) => {
    renderComposer({ models });
    expect(screen.queryByRole('combobox', { name: 'Choose model' })).not.toBeInTheDocument();
    expect(screen.queryByText('Model Router')).not.toBeInTheDocument();
    expect(screen.queryByText('Operator default')).not.toBeInTheDocument();
  });

  it('keeps the picker value for the operator row', () => {
    renderComposer({ model: { id: MODEL_ROUTER_ID, name: 'Model Router' } });
    expect(screen.getByRole('combobox', { name: 'Choose model' })).toHaveTextContent('Operator default');
  });
});
