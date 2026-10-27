// The platform build's copy for the lines a web build without the platform UI
// words differently (selfHostedCopy.platformUi.test.jsx). These pin today's
// wording, so the self-hosted variants can't leak into hosted web.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

vi.hoisted(() => {
  window.COWORK_DEPLOYMENT_BRAND = { productName: 'Acme Cowork' };
});

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

describe('platform build', () => {
  it('points an empty web list at the desktop app', () => {
    expect(surfaceCopy(true)).toEqual({
      tasksNote: 'Tasks made in the desktop app stay there.',
      artifactsNote: 'Artifacts made in the desktop app stay there.',
    });
  });

  // Hosted web runs scheduled tasks on its server like any web build, so it
  // shares the self-hosted wording rather than the desktop app's.
  it('says scheduled tasks run on the server', () => {
    render(<ScheduledView {...scheduledProps} />);
    expect(screen.getByText(
      "Scheduled Anton tasks run on the server, even with this tab closed. If a run was due while the server was down, Anton runs the latest one when it's back.",
    )).toBeInTheDocument();
    expect(screen.getByText(
      'Create a recurring Anton task — a Monday digest, an hourly log sweep, a daily KPI snapshot. Anton runs them on the server, even with this tab closed.',
    )).toBeInTheDocument();
  });

  it('describes the cadence without a desktop requirement when scheduling', () => {
    render(<ScheduleTaskModal open onClose={noop} onSubmit={noop} projects={[]} agentLabel="Anton" />);
    expect(screen.getByText('Anton runs this prompt on the cadence you set.')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('Ask Anton to…')).toBeInTheDocument();
  });

  it('points the empty artifacts list at the desktop app', () => {
    render(<ArtifactsView artifacts={[]} agentLabel="Anton" />);
    expect(screen.getByText('Artifacts made in the desktop app stay there.')).toBeInTheDocument();
  });

  it('confirms stopped sharing on MindsHub', async () => {
    const shared = {
      id: 'a1', path: '/proj/.anton/artifacts/weather/index.html', title: 'Weather Dashboard',
      type: 'html-app', mtime: 1, publishedUrl: 'https://share.example/r/abc',
    };
    render(<ArtifactsView artifacts={[shared]} agentLabel="Anton" />);
    fireEvent.click(screen.getByLabelText('Artifact menu'));
    fireEvent.click(screen.getByText('Stop sharing'));
    await vi.waitFor(() => expect(toastAdd).toHaveBeenCalledWith({ title: 'Stopped sharing on MindsHub.', type: 'success' }));
  });

  it('asks for a MindsHub sign-in on web', () => {
    expect(LOGOUT_CONFIRM_COPY.message).toBe("This signs you out of Cowork. You'll need to sign in again with MindsHub to keep using it.");
  });

  it('points a connector without an id at the desktop app', () => {
    const conversationId = 'conv-platform-oauth-copy';
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
    expect(screen.getByText('This connector cannot be authorized in the browser (no connector id). Use the desktop app.')).toBeInTheDocument();
  });
});
