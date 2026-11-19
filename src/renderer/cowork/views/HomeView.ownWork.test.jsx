// The checklist's "Start with your own work" row opens Home in the own-work
// mode. Nothing goes out until the person gives Cowork something of theirs (a
// file, pasted text or a link); a job is optional; what is sent asks Cowork to
// start on stated assumptions rather than open with a question.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useEffect, useState } from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import HomeView from './HomeView';
import { composeOwnWorkMessage, OWN_WORK_START_NOW } from '../components/taskmodes/taskModes';
import { getSnapshot, reset } from '../components/onboarding/onboardingStore';
import { __resetDraftsForTests, getDraft, setDraft } from '../lib/draftStore';
import { captureConsoleHandoff, findSample } from '../lib/consoleHandoff';

const { trackOnboardingStepCompleted } = vi.hoisted(() => ({
  trackOnboardingStepCompleted: vi.fn(),
}));
vi.mock('../lib/analytics', async (importOriginal) => ({
  ...(await importOriginal()),
  trackOnboardingStepCompleted,
}));
vi.mock('../api', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, fetchSkills: vi.fn(async () => []) };
});

const JOB = 'Clean up this customer list and flag duplicates.';
// What a console own-work link placed in the composer before this mode.
const RETIRED_OWN_WORK_PROMPT = 'I\'d like to start with something real from my work. Ask me one question about what I\'m working on, and give me two or three small examples to jump-start it, like a report to update, a spreadsheet to clean, or a thread to answer. Tell me I can attach a file, paste notes or a link, or connect Gmail, and say you\'ll take the first step once I answer.';
const FILE = { id: 'f1', name: 'customers.csv', size: 1024 };

// Holds the prefill and the request the way App does.
function Home({ onSend, attachments = [], onAttachFiles = vi.fn(), request = 1, examples = 0, onConsumed = vi.fn() }) {
  const [prefill, setPrefill] = useState(null);
  const [ownWorkRequest, setOwnWorkRequest] = useState(request);
  const [examplesRequest, setExamplesRequest] = useState(examples);
  useEffect(() => { if (request) setOwnWorkRequest(request); }, [request]);
  return (
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
      attachments={attachments}
      onAttachFiles={onAttachFiles}
      onRemoveAttachment={vi.fn()}
      onAddGoogleDriveFiles={vi.fn()}
      onNavigateToConnectors={vi.fn()}
      prefill={prefill}
      onPrefill={(text, select) => setPrefill({ text, bump: Date.now(), select })}
      onPrefillConsumed={() => setPrefill(null)}
      ownWorkRequest={ownWorkRequest}
      examplesRequest={examplesRequest}
      onExamplesRequestConsumed={() => setExamplesRequest(0)}
      onOwnWorkRequestConsumed={() => { onConsumed(); setOwnWorkRequest(0); }}
    />
  );
}

const sendButton = () => screen.getByRole('button', { name: 'Send' });

beforeEach(() => {
  window.localStorage.clear();
  __resetDraftsForTests();
  reset();
  trackOnboardingStepCompleted.mockClear();
});

describe('HomeView own-work mode', () => {
  it('opens from the checklist row with its heading, one Attach button and the jobs, and sends nothing', async () => {
    const onSend = vi.fn(async () => true);
    const onConsumed = vi.fn();
    render(<Home onSend={onSend} onConsumed={onConsumed} />);

    expect(await screen.findByText('What should Cowork work on?')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Remove Your work mode' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Attach a file/ })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Finance and admin' })).toHaveAttribute('aria-selected', 'true');
    expect(onConsumed).toHaveBeenCalledTimes(1);
    expect(onSend).not.toHaveBeenCalled();
    expect(sendButton()).toBeDisabled();
  });

  it('offers no way out to the connectors or a Drive sign-in', async () => {
    render(<Home onSend={vi.fn()} />);
    await screen.findByText('What should Cowork work on?');

    expect(screen.queryByRole('button', { name: /Connect an app/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Google Drive/ })).not.toBeInTheDocument();
  });

  it('does not send a job on its own, and says what is missing', async () => {
    const onSend = vi.fn(async () => true);
    render(<Home onSend={onSend} />);
    const user = userEvent.setup();
    await user.click(await screen.findByRole('tab', { name: 'Sales and marketing' }));
    await user.click(screen.getByText(JOB));

    await waitFor(() => expect(screen.getByRole('textbox')).toHaveValue(`${JOB} `));
    expect(screen.getByText(/Now add what it should work on/)).toBeInTheDocument();
    expect(sendButton()).toBeDisabled();
    await user.click(screen.getByRole('textbox'));
    await user.keyboard('{Enter}');
    await new Promise((r) => setTimeout(r, 30));
    expect(onSend).not.toHaveBeenCalled();
  });

  it('sends a job with a file as the tested message, credited to the checklist', async () => {
    const onSend = vi.fn(async () => true);
    const { rerender } = render(<Home onSend={onSend} />);
    const user = userEvent.setup();
    await user.click(await screen.findByRole('tab', { name: 'Sales and marketing' }));
    await user.click(screen.getByText(JOB));
    rerender(<Home onSend={onSend} attachments={[FILE]} />);

    await waitFor(() => expect(sendButton()).toBeEnabled());
    await user.click(sendButton());

    await waitFor(() => expect(onSend).toHaveBeenCalledTimes(1));
    expect(onSend.mock.calls[0][0]).toBe(`${JOB} ${OWN_WORK_START_NOW}`);
    expect(onSend.mock.calls[0][1]).toMatchObject({ startVia: 'checklist' });
    await waitFor(() => expect(getSnapshot().completed.has('bring-your-work')).toBe(true));
    expect(trackOnboardingStepCompleted).toHaveBeenCalledWith('bring-your-work', 'checklist');
    expect(getSnapshot().completed.has('see-it-work')).toBe(false);
  });

  it('sends pasted text with no job, under the generic first step', async () => {
    const onSend = vi.fn(async () => true);
    render(<Home onSend={onSend} />);
    const user = userEvent.setup();
    await screen.findByText('What should Cowork work on?');
    await user.click(screen.getByRole('textbox'));
    await user.paste('https://example.com/post-mortem');
    await user.keyboard('{Enter}');

    await waitFor(() => expect(onSend).toHaveBeenCalledTimes(1));
    expect(onSend.mock.calls[0][0]).toBe(composeOwnWorkMessage('https://example.com/post-mortem'));
  });

  it('sends a file alone, with nothing typed', async () => {
    const onSend = vi.fn(async () => true);
    render(<Home onSend={onSend} attachments={[FILE]} />);
    await screen.findByText('What should Cowork work on?');

    await waitFor(() => expect(sendButton()).toBeEnabled());
    await userEvent.setup().click(sendButton());

    await waitFor(() => expect(onSend).toHaveBeenCalledTimes(1));
    expect(onSend.mock.calls[0][0]).toBe(composeOwnWorkMessage(''));
  });

  it('leaves the step pending when the send does not go out', async () => {
    const onSend = vi.fn(async () => false);
    render(<Home onSend={onSend} />);
    const user = userEvent.setup();
    await screen.findByText('What should Cowork work on?');
    await user.click(screen.getByRole('textbox'));
    await user.paste('notes from the call');
    await user.keyboard('{Enter}');

    await waitFor(() => expect(onSend).toHaveBeenCalled());
    expect(getSnapshot().completed.has('bring-your-work')).toBe(false);
  });

  it('hands the picked files to the composer\'s attachments', async () => {
    const onAttachFiles = vi.fn();
    const { container } = render(<Home onSend={vi.fn()} onAttachFiles={onAttachFiles} />);
    await screen.findByText('What should Cowork work on?');
    const input = [...container.querySelectorAll('input[type="file"]')].find((el) => el.closest('[aria-label="Ways to bring your work"]'));
    const file = new File(['a,b'], 'customers.csv', { type: 'text/csv' });

    fireEvent.change(input, { target: { files: [file] } });

    expect(onAttachFiles).toHaveBeenCalledTimes(1);
    expect(onAttachFiles.mock.calls[0][0][0]).toBe(file);
  });

  it('shows the jobs for the kind of work picked', async () => {
    render(<Home onSend={vi.fn()} />);
    const user = userEvent.setup();
    await screen.findByText('What should Cowork work on?');
    expect(screen.getByText('Turn these bank statements or invoices into one spreadsheet.')).toBeInTheDocument();

    await user.click(screen.getByRole('tab', { name: 'Contracts and research' }));

    expect(screen.getByText('Summarize the key terms and risks in this contract.')).toBeInTheDocument();
    expect(screen.queryByText('Turn these bank statements or invoices into one spreadsheet.')).not.toBeInTheDocument();
  });

  it('goes back to the usual Home once the mode is removed', async () => {
    render(<Home onSend={vi.fn()} />);
    const user = userEvent.setup();
    await screen.findByText('What should Cowork work on?');

    await user.click(screen.getByRole('button', { name: 'Remove Your work mode' }));

    expect(screen.queryByText('What should Cowork work on?')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Attach a file/ })).not.toBeInTheDocument();
  });

  it('drops an example left unsent when the row opens the mode, and the send completes only this step', async () => {
    const snake = findSample('games', 'classic-snake-game').sample;
    const onSend = vi.fn(async () => true);
    const { rerender } = render(<Home onSend={onSend} request={0} examples={1} />);
    const user = userEvent.setup();
    await user.click(await screen.findByText('Classic snake game'));
    await waitFor(() => expect(screen.getByRole('textbox')).toHaveValue(snake.prompt));

    rerender(<Home onSend={onSend} request={2} examples={0} />);

    await screen.findByText('What should Cowork work on?');
    await waitFor(() => expect(screen.getByRole('textbox')).toHaveValue(''));
    expect(sendButton()).toBeDisabled();
    await user.click(screen.getByRole('textbox'));
    await user.paste('notes from the call');
    await user.keyboard('{Enter}');
    await waitFor(() => expect(onSend).toHaveBeenCalledTimes(1));
    expect(onSend.mock.calls[0][0]).toBe(composeOwnWorkMessage('notes from the call'));
    await waitFor(() => expect(getSnapshot().completed.has('bring-your-work')).toBe(true));
    expect(getSnapshot().completed.has('see-it-work')).toBe(false);
  });

  it('keeps the person\'s own unsent text when the row opens the mode', async () => {
    setDraft('new', 'my own half-written note');
    render(<Home onSend={vi.fn()} />);
    await screen.findByText('What should Cowork work on?');

    expect(screen.getByRole('textbox')).toHaveValue('my own half-written note');
    expect(sendButton()).toBeEnabled();
  });

  it('keeps pasted text when a job is picked after it, and swaps only the job when another is picked', async () => {
    render(<Home onSend={vi.fn()} />);
    const user = userEvent.setup();
    await screen.findByText('What should Cowork work on?');
    await user.click(screen.getByRole('textbox'));
    await user.paste('name,email\nAda,ada@example.com');

    await user.click(screen.getByRole('tab', { name: 'Sales and marketing' }));
    await user.click(screen.getByText(JOB));
    await waitFor(() => expect(screen.getByRole('textbox')).toHaveValue(`${JOB} name,email\nAda,ada@example.com`));

    const other = 'Compare these two price lists and show what changed.';
    await user.click(screen.getByText(other));
    await waitFor(() => expect(screen.getByRole('textbox')).toHaveValue(`${other} name,email\nAda,ada@example.com`));
    expect(screen.queryByText(/Now add what it should work on/)).not.toBeInTheDocument();
  });

  it('stops asking for material once the person types some after the job', async () => {
    render(<Home onSend={vi.fn()} />);
    const user = userEvent.setup();
    await user.click(await screen.findByRole('tab', { name: 'Sales and marketing' }));
    await user.click(screen.getByText(JOB));
    expect(await screen.findByText(/Now add what it should work on/)).toBeInTheDocument();

    await user.click(screen.getByRole('textbox'));
    await user.keyboard('{End}Ada');

    await waitFor(() => expect(screen.queryByText(/Now add what it should work on/)).not.toBeInTheDocument());
    expect(getDraft('new')).toBe(`${JOB} Ada`);
  });

  it('drops the retired own-work prompt left in the composer when the row opens the mode', async () => {
    setDraft('new', RETIRED_OWN_WORK_PROMPT);
    render(<Home onSend={vi.fn()} />);
    await screen.findByText('What should Cowork work on?');

    await waitFor(() => expect(screen.getByRole('textbox')).toHaveValue(''));
    expect(sendButton()).toBeDisabled();
  });

  it('drops the retired own-work prompt when a console link opens the mode', async () => {
    setDraft('new', RETIRED_OWN_WORK_PROMPT);
    captureConsoleHandoff({ search: '?from=console&start=own-work', pathname: '/', hash: '' });
    render(<Home onSend={vi.fn()} request={0} />);
    await screen.findByText('What should Cowork work on?');

    await waitFor(() => expect(screen.getByRole('textbox')).toHaveValue(''));
    expect(sendButton()).toBeDisabled();
  });

  it('keeps Send off when a picked job is shortened or reworded with nothing added', async () => {
    const onSend = vi.fn(async () => true);
    render(<Home onSend={onSend} />);
    const user = userEvent.setup();
    await user.click(await screen.findByRole('tab', { name: 'Sales and marketing' }));
    await user.click(screen.getByText(JOB));
    await waitFor(() => expect(screen.getByRole('textbox')).toHaveValue(`${JOB} `));

    await user.clear(screen.getByRole('textbox'));
    await user.type(screen.getByRole('textbox'), 'Clean up this customer list.');
    await new Promise((r) => setTimeout(r, 30));
    expect(sendButton()).toBeDisabled();
    expect(screen.getByText(/Now add what it should work on/)).toBeInTheDocument();
    await user.keyboard('{Enter}');
    expect(onSend).not.toHaveBeenCalled();
  });

  it('sends an edited job once the person adds a link or some words of their own', async () => {
    const onSend = vi.fn(async () => true);
    render(<Home onSend={onSend} />);
    const user = userEvent.setup();
    await user.click(await screen.findByRole('tab', { name: 'Sales and marketing' }));
    await user.click(screen.getByText(JOB));
    await user.clear(screen.getByRole('textbox'));
    await user.type(screen.getByRole('textbox'), 'Clean up this customer list ');
    await user.paste('https://example.com/customers.csv');

    await waitFor(() => expect(sendButton()).toBeEnabled());
    expect(screen.queryByText(/Now add what it should work on/)).not.toBeInTheDocument();
  });

  it('sends the person\'s own short request once they replace the job entirely', async () => {
    const onSend = vi.fn(async () => true);
    render(<Home onSend={onSend} />);
    const user = userEvent.setup();
    await user.click(await screen.findByRole('tab', { name: 'Sales and marketing' }));
    await user.click(screen.getByText(JOB));
    await user.clear(screen.getByRole('textbox'));
    await user.type(screen.getByRole('textbox'), 'Q3 numbers');

    await waitFor(() => expect(sendButton()).toBeEnabled());
    await user.keyboard('{Enter}');
    await waitFor(() => expect(onSend).toHaveBeenCalledTimes(1));
    expect(onSend.mock.calls[0][0]).toBe(composeOwnWorkMessage('Q3 numbers'));
  });

  it('swaps an edited job for the next one picked instead of joining them', async () => {
    render(<Home onSend={vi.fn()} />);
    const user = userEvent.setup();
    await user.click(await screen.findByRole('tab', { name: 'Sales and marketing' }));
    await user.click(screen.getByText(JOB));
    await user.clear(screen.getByRole('textbox'));
    await user.type(screen.getByRole('textbox'), 'Clean up this customer list');

    const other = 'Compare these two price lists and show what changed.';
    await user.click(screen.getByText(other));
    await waitFor(() => expect(screen.getByRole('textbox')).toHaveValue(`${other} `));
  });

  it('clears a job with nothing added when the mode is removed, so it cannot go out bare', async () => {
    render(<Home onSend={vi.fn()} />);
    const user = userEvent.setup();
    await user.click(await screen.findByRole('tab', { name: 'Sales and marketing' }));
    await user.click(screen.getByText(JOB));
    await waitFor(() => expect(screen.getByRole('textbox')).toHaveValue(`${JOB} `));

    await user.click(screen.getByRole('button', { name: 'Remove Your work mode' }));

    await waitFor(() => expect(screen.getByRole('textbox')).toHaveValue(''));
    expect(sendButton()).toBeDisabled();
  });

  it('keeps a job with material when the mode is removed', async () => {
    render(<Home onSend={vi.fn()} />);
    const user = userEvent.setup();
    await user.click(await screen.findByRole('tab', { name: 'Sales and marketing' }));
    await user.click(screen.getByText(JOB));
    await user.click(screen.getByRole('textbox'));
    await user.keyboard('{End}Ada, Bob, Ada');

    await user.click(screen.getByRole('button', { name: 'Remove Your work mode' }));

    expect(screen.getByRole('textbox')).toHaveValue(`${JOB} Ada, Bob, Ada`);
  });

  it('clears a job left bare from an earlier visit when Home opens without the mode', async () => {
    setDraft('new', `${JOB} `);
    render(<Home onSend={vi.fn()} request={0} />);

    await waitFor(() => expect(screen.getByRole('textbox')).toHaveValue(''));
  });

  it('opens the mode without a console example when the row was clicked before the composer was ready', async () => {
    captureConsoleHandoff({ search: '?from=console&mode=games&sample=classic-snake-game', pathname: '/', hash: '' });
    render(<Home onSend={vi.fn()} request={1} />);
    await screen.findByText('What should Cowork work on?');

    await new Promise((r) => setTimeout(r, 30));
    expect(screen.getByRole('textbox')).toHaveValue('');
    expect(screen.queryByText(/Edit this prompt/)).not.toBeInTheDocument();
  });

  it('retires the console example hint when the row opens the mode', async () => {
    captureConsoleHandoff({ search: '?from=console&mode=games&sample=classic-snake-game', pathname: '/', hash: '' });
    const { rerender } = render(<Home onSend={vi.fn()} request={0} />);
    expect(await screen.findByText(/Edit this prompt/)).toBeInTheDocument();

    rerender(<Home onSend={vi.fn()} request={2} />);

    await screen.findByText('What should Cowork work on?');
    expect(screen.queryByText(/Edit this prompt/)).not.toBeInTheDocument();
  });

  it('moves between kinds of work with the arrow keys', async () => {
    render(<Home onSend={vi.fn()} />);
    const user = userEvent.setup();
    const first = await screen.findByRole('tab', { name: 'Finance and admin' });
    first.focus();
    await user.keyboard('{ArrowRight}');
    await user.keyboard('{Enter}');

    await waitFor(() => expect(screen.getByRole('tab', { name: 'Sales and marketing' })).toHaveAttribute('aria-selected', 'true'));
    expect(screen.getByText(JOB)).toBeInTheDocument();
  });
});
