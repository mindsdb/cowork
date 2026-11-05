import { fireEvent, render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';

vi.mock('../../lib/deployment', () => ({ PLATFORM_UI: false }));
vi.mock('../api', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, fetchSkills: vi.fn(async () => ({ skills: [] })) };
});

import Composer from './Composer';

const model = { id: 'configured-model', name: 'Configured model' };
const modelMeta = {
  modelEfforts: { [model.id]: { efforts: ['low', 'medium', 'high'], default: 'medium' } },
};

it.each([
  ['empty catalog', [], false],
  ['populated catalog with effort levels', [model], false],
  ['read-only model', [model], true],
])('hides every model and effort control with %s while keeping Send', (_name, models, modelReadOnly) => {
  const onSend = vi.fn();
  render(<Composer
    onSend={onSend}
    projects={[]}
    models={models}
    model={model}
    modelMeta={modelMeta}
    modelReadOnly={modelReadOnly}
    effort="high"
    onModelChange={vi.fn()}
    onEffortChange={vi.fn()}
    onOpenSettings={vi.fn()}
  />);

  expect(screen.queryByText('Model Router')).not.toBeInTheDocument();
  expect(screen.queryByRole('combobox', { name: 'Choose model' })).not.toBeInTheDocument();
  expect(screen.queryByRole('combobox', { name: 'Reasoning effort' })).not.toBeInTheDocument();
  expect(screen.queryByTitle('Model is fixed for this task')).not.toBeInTheDocument();
  expect(screen.queryByText(model.name)).not.toBeInTheDocument();
  fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Summarize the week' } });
  fireEvent.click(screen.getByRole('button', { name: 'Send', exact: true }));
  expect(onSend).toHaveBeenCalledWith('Summarize the week');
});
