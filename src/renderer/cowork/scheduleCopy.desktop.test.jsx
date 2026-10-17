// The desktop app runs scheduled tasks on its own local server, so its copy
// says they run while the app is open. Web builds say they run on the server
// (selfHostedCopy tests).
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

vi.mock('../platform/host', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, host: { ...actual.host, isWeb: false, isElectron: true } };
});

import ScheduledView from './views/ScheduledView';
import ScheduleTaskModal from './components/schedule/ScheduleTaskModal';

const noop = vi.fn();
const scheduledProps = {
  scheduled: [], projects: [], selectedProject: null, agentLabel: 'Anton',
  onCreate: noop, onUpdate: noop, onDelete: noop, onPause: noop, onResume: noop,
  onRunNow: noop, onOpenSchedule: noop, onOpenProject: noop,
};

describe('desktop app', () => {
  it('says scheduled tasks run while the app is open', () => {
    render(<ScheduledView {...scheduledProps} />);
    expect(screen.getByText(/^Local scheduled Anton tasks run while .+ is open\. If a run was due while the app was closed, Anton runs the latest one when it reopens\.$/)).toBeInTheDocument();
    expect(screen.getByText(/Anton runs them while the desktop app is open\.$/)).toBeInTheDocument();
  });

  it('says the app must be open when scheduling', () => {
    render(<ScheduleTaskModal open onClose={noop} onSubmit={noop} projects={[]} agentLabel="Anton" />);
    expect(screen.getByText('Anton runs this on its own while MindsHub is open.')).toBeInTheDocument();
  });
});
