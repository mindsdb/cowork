// An example the person picked keeps its meaning when they edit it: a plain one
// is sent as written and the checklist counts it, wherever in the text they
// changed it.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import HomeView from './HomeView';
import { TASK_MODES } from '../components/taskmodes/taskModes';
import { getSnapshot, reset } from '../components/onboarding/onboardingStore';

vi.mock('../api', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, fetchSkills: vi.fn(async () => []) };
});

const mode = TASK_MODES.find((m) => m.instruction && m.samples.some((s) => s.plain));
const plain = mode.samples.find((s) => s.plain);
const ordinary = mode.samples.find((s) => !s.plain);

const renderHome = (onSend) =>
  render(
    <HomeView
      onSend={onSend}
      activeTasks={[]}
      onSelectTask={vi.fn()}
      onClearActive={vi.fn()}
      project={{ name: 'general' }}
      projects={[{ name: 'general' }]}
      models={[]}
      onProjectChange={vi.fn()}
      onModelChange={vi.fn()}
      configReady
      serverOnline
      skipIntro
      onPrefill={vi.fn()}
    />
  );

// The test's onPrefill does not fill the composer, so the person's edited text is pasted in.
const pickThenSend = async (user, sample, text) => {
  await user.click(await screen.findByRole('button', { name: mode.pillLabel }));
  await user.click(await screen.findByRole('button', { name: sample.label }));
  await user.click(screen.getByRole('textbox'));
  await user.paste(text);
  await user.keyboard('{Enter}');
};

beforeEach(() => {
  window.localStorage.clear();
  reset();
});

describe('an example picked and then edited', () => {
  it('sends a plain example as written when it is edited in the middle, and counts it as tried', async () => {
    const onSend = vi.fn(async () => true);
    renderHome(onSend);
    const edited = plain.prompt.replace(/\b\w{4,}\b/, 'changed');

    await pickThenSend(userEvent.setup(), plain, edited);

    await waitFor(() => expect(onSend).toHaveBeenCalled());
    expect(onSend.mock.calls[0][0]).toBe(edited);
    await waitFor(() => expect(getSnapshot().completed.has('see-it-work')).toBe(true));
  });

  it('still adds the mode instruction to an edited ordinary example', async () => {
    const onSend = vi.fn(async () => true);
    renderHome(onSend);
    const edited = ordinary.prompt.replace(/\b\w{4,}\b/, 'changed');

    await pickThenSend(userEvent.setup(), ordinary, edited);

    await waitFor(() => expect(onSend).toHaveBeenCalled());
    expect(onSend.mock.calls[0][0]).toBe(`${edited}\n\n${mode.instruction}`);
  });

  it('does not count the example as tried when the send does not go out', async () => {
    const onSend = vi.fn(async () => false);
    renderHome(onSend);

    await pickThenSend(userEvent.setup(), plain, plain.prompt.replace(/\b\w{4,}\b/, 'changed'));

    await waitFor(() => expect(onSend).toHaveBeenCalled());
    expect(getSnapshot().completed.has('see-it-work')).toBe(false);
  });
});
