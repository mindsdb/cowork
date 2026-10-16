// A web build without the platform UI runs against its own server: no
// desktop app beside it, no MindsHub sign-in, and scheduled tasks run on that
// server. Every line below used to tell such a deployment's users about a
// desktop app or MindsHub. selfHostedCopy.test.jsx pins the same lines on the
// platform build, where they must not change.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

vi.mock('../lib/deployment', () => ({ PLATFORM_UI: false }));
vi.mock('../platform/host', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    host: {
      ...actual.host, isWeb: true, isElectron: false, isMac: () => false,
      openExternal: vi.fn(), logout: vi.fn(), getApiOrigin: () => 'https://cowork.example',
    },
  };
});
vi.mock('./api', async (importOriginal) => ({
  ...(await importOriginal()),
  unpublishArtifact: vi.fn(async () => {}),
  publishTargetPath: vi.fn(() => 'target'),
  artifactServeUrl: vi.fn(() => ''),
}));
vi.mock('./lib/analytics', async (importOriginal) => ({
  ...(await importOriginal()),
  trackArtifactPublished: vi.fn(),
  trackDataSourceConnected: vi.fn(),
  resetDeviceIdentity: vi.fn(),
}));
const toastAdd = vi.hoisted(() => vi.fn());
vi.mock('./components/ui/Toast', async (importOriginal) => ({
  ...(await importOriginal()),
  useToastManager: () => ({ add: toastAdd }),
}));

import { surfaceCopy } from './lib/surface';
import { LOGOUT_CONFIRM_COPY } from './hooks/useLogout';
import ScheduledView from './views/ScheduledView';
import ScheduleTaskModal from './components/schedule/ScheduleTaskModal';
import ArtifactsView from './views/ArtifactsView';
import { DataVaultFormPanel } from './components/datavault/DataVaultFormPanel';
import { clearForm, setForm } from './components/datavault/formStore';

const noop = vi.fn();
const scheduledProps = {
  scheduled: [], projects: [], selectedProject: null, agentLabel: 'Anton',
  onCreate: noop, onUpdate: noop, onDelete: noop, onPause: noop, onResume: noop,
  onRunNow: noop, onOpenSchedule: noop, onOpenProject: noop,
};

beforeEach(() => {
  localStorage.clear();
  toastAdd.mockClear();
});

describe('web build without the platform UI', () => {
  it('has no other app to point at from an empty list', () => {
    expect(surfaceCopy(true)).toEqual({ tasksNote: '', artifactsNote: '' });
  });

  it('says scheduled tasks run on the server', () => {
    render(<ScheduledView {...scheduledProps} />);
    expect(screen.getByText(
      "Scheduled Anton tasks run on the server, even with this tab closed. If a run was due while the server was down, Anton runs the latest one when it's back.",
    )).toBeInTheDocument();
    expect(screen.getByText(
      'Create a recurring Anton task — a Monday digest, an hourly log sweep, a daily KPI snapshot. Anton runs them on the server, even with this tab closed.',
    )).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/desktop app|MindsHub/);
  });

  it('describes the cadence without a desktop requirement when scheduling', () => {
    render(<ScheduleTaskModal open onClose={noop} onSubmit={noop} projects={[]} agentLabel="Anton" />);
    expect(screen.getByText('Anton runs this on its own, even with this tab closed.')).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/desktop app/);
  });

  it('keeps the edit subtitle, which never named the desktop app', () => {
    render(<ScheduleTaskModal open onClose={noop} onSubmit={noop} projects={[]} agentLabel="Anton"
      task={{ id: 's1', title: 'Digest', prompt: 'p', cadence: 'daily', enabled: true }} />);
    expect(screen.getByText('Changes apply from the next run.')).toBeInTheDocument();
  });

  it('shows no other-app note in the empty artifacts list', () => {
    render(<ArtifactsView artifacts={[]} agentLabel="Anton" />);
    expect(screen.getByText('No artifacts yet')).toBeInTheDocument();
    expect(screen.queryByText(/stay there/)).toBeNull();
  });

  it('confirms stopped sharing without naming MindsHub', async () => {
    const shared = {
      id: 'a1', path: '/proj/.anton/artifacts/weather/index.html', title: 'Weather Dashboard',
      type: 'html-app', mtime: 1, publishedUrl: 'https://share.example/r/abc',
    };
    render(<ArtifactsView artifacts={[shared]} agentLabel="Anton" />);
    fireEvent.click(screen.getByLabelText('Artifact menu'));
    fireEvent.click(screen.getByText('Stop sharing'));
    await vi.waitFor(() => expect(toastAdd).toHaveBeenCalledWith({ title: 'Stopped sharing.', type: 'success' }));
  });

  it('asks for a sign-in without naming MindsHub', () => {
    expect(LOGOUT_CONFIRM_COPY.message).toBe("This signs you out of Cowork. You'll need to sign in again to keep using it.");
  });

  it('explains a connector without an id without pointing at the desktop app', () => {
    const conversationId = 'conv-self-hosted-oauth-copy';
    clearForm(conversationId);
    setForm(conversationId, {
      form_id: 'oauth-copy',
      title: 'Connect test provider',
      methods: [{
        id: 'oauth', label: 'Browser authorization', submit_action: 'oauth_launch', fields: [],
        oauth: { client_id: 'c', auth_url: 'https://oauth.invalid/a', token_url: 'https://oauth.invalid/t', scopes: [] },
      }],
    });
    render(<DataVaultFormPanel conversationId={conversationId} />);
    fireEvent.click(screen.getByRole('button', { name: /submit|connect/i }));
    expect(screen.getByText('This connector cannot be authorized in this web UI.')).toBeInTheDocument();
  });
});
