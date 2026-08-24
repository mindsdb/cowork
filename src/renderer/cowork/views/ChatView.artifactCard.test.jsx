// The inline artifact banner has to be able to open what it announces.
//
// The card travels server → SSE adapter (`step.data`) → `artifactStepToCard` →
// `ArtifactCard`, and the two middle hops each copy a hand-written list of
// fields. `publishedUrl` was in neither, so on an org deployment the banner
// appeared, the click was gated away from the local preview — correctly, that
// content is not served there — and then had no URL to fall back to. The user
// got "no published link yet" for an artifact that was published.
//
// responseStreamAdapter.test.js covers the first hop in isolation. This drives
// the whole chain the way a user meets it, because a field surviving one hop and
// not the next is exactly the failure that shipped.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const openExternal = vi.fn();
const openPath = vi.fn();

// Liveness is the store's business and is unit-tested there. Here we drive the
// card against a controllable answer, because what shipped broken was the CARD:
// it offered Open / Export / Show in Finder for an artifact that was gone.
const deleted = vi.fn(() => false);
const revalidate = vi.fn(() => Promise.resolve());

vi.mock('../lib/artifactsStore', () => ({
  useArtifactLiveness: (card, opts) => deleted(card, opts),
  setArtifactsScope: vi.fn(),
  revalidate: (...a) => revalidate(...a),
}));

vi.mock('../../platform/host', () => ({
  host: {
    isElectron: false,
    isWeb: false,
    isMac: () => false,
    getPlatform: () => 'linux',
    getApiOrigin: () => 'http://localhost:1',
    openPath: (...a) => openPath(...a),
    openExternal: (...a) => openExternal(...a),
  },
  getAccessToken: vi.fn(async () => null),
  isElectron: false,
}));

import ChatView from './ChatView';
import { setOrgMode } from '../../lib/orgMode';

const PUBLISHED_URL = 'https://view.staging.mindshub.ai/view/97901f016/845b3777';

// The shape the SSE adapter produces for `response.artifact_created`.
const artifactStep = (overrides = {}) => ({
  id: 'artifact-clock',
  label: 'Current time',
  badge: 'Artifact',
  icon: 'sparkle',
  status: 'completed',
  data: {
    title: 'Current time',
    file_path: '/proj/.anton/artifacts/clock/index.html',
    path: '/proj/.anton/artifacts/clock/index.html',
    ext: '.html',
    action: 'html-app',
    id: '7db94eb8',
    slug: 'clock',
    publishedUrl: PUBLISHED_URL,
    projectId: 'proj-1',
    projectName: 'general',
    ...overrides,
  },
});

const taskWithArtifact = (step) => ({
  id: 'conv-a',
  title: 'Alpha task',
  status: 'active',
  messages: [
    { role: 'user', content: 'build me a clock' },
    { role: 'assistant', content: 'Done.', steps: [step] },
  ],
});

beforeEach(() => {
  openExternal.mockClear();
  openPath.mockReset();
  deleted.mockReset();
  deleted.mockReturnValue(false);
  revalidate.mockClear();
});
afterEach(() => setOrgMode(false));

describe('inline artifact banner in org mode', () => {
  it('opens the published URL', async () => {
    setOrgMode(true);
    const user = userEvent.setup();
    render(<ChatView task={taskWithArtifact(artifactStep())} />);

    await user.click(screen.getByRole('button', { name: 'Open' }));

    expect(openExternal).toHaveBeenCalledWith(PUBLISHED_URL);
  });

  it('offers no Open button while the artifact has no published URL', async () => {
    // Autopublish is off, or the turn's publish failed. Better to offer nothing
    // than a button that reports an error the user cannot act on.
    setOrgMode(true);
    render(<ChatView task={taskWithArtifact(artifactStep({ publishedUrl: '' }))} />);

    expect(screen.queryByRole('button', { name: 'Open' })).toBeNull();
  });
});

describe('inline artifact banner on desktop', () => {
  it('still opens the in-app preview rather than the published URL', async () => {
    // The org gate must not leak into desktop: there the local preview is the
    // point, and a published URL may exist alongside it.
    setOrgMode(false);
    const user = userEvent.setup();
    render(<ChatView task={taskWithArtifact(artifactStep())} />);

    await user.click(screen.getByRole('button', { name: 'Open' }));

    expect(openExternal).not.toHaveBeenCalled();
  });
});

describe('inline artifact banner for a deleted artifact', () => {
  it('offers none of the actions and says it is deleted', () => {
    // ENG-1673: the card stayed fully active after the artifact was deleted in
    // Live Artifacts, and Open then 404'd.
    deleted.mockReturnValue(true);
    render(<ChatView task={taskWithArtifact(artifactStep())} />);

    expect(screen.queryByRole('button', { name: 'Open' })).toBeNull();
    expect(screen.queryByRole('button', { name: /Export/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /Show in/ })).toBeNull();
    expect(screen.getByText('Deleted')).toBeInTheDocument();
  });

  it('leaves the title unclickable', () => {
    deleted.mockReturnValue(true);
    render(<ChatView task={taskWithArtifact(artifactStep())} />);

    expect(screen.getByRole('button', { name: 'Current time' })).toBeDisabled();
  });

  it('keeps every action while the artifact is alive', () => {
    // The inverse case, so the test catches a regression rather than a card
    // that simply turned everything off.
    render(<ChatView task={taskWithArtifact(artifactStep())} />);

    expect(screen.getByRole('button', { name: 'Open' })).toBeInTheDocument();
    expect(screen.queryByText('Deleted')).toBeNull();
  });

  it('does not judge a card of an unfinished turn', () => {
    // The streaming render site must ask with live=true: the agent just made
    // this artifact, and the index predates it (§4.5).
    render(<ChatView task={{
      id: 'conv-a',
      title: 'Alpha task',
      status: 'active',
      messages: [
        { role: 'user', content: 'build me a clock' },
        { role: '_streaming', content: '', steps: [artifactStep()] },
      ],
    }} />);

    expect(deleted).toHaveBeenCalledWith(expect.anything(), { live: true });
  });

  it('judges a card of a committed turn', () => {
    render(<ChatView task={taskWithArtifact(artifactStep())} />);

    expect(deleted).toHaveBeenCalledWith(expect.anything(), { live: false });
  });
});

describe('a failed action revalidates', () => {
  // A .pdf has no inline preview, so Open goes to the OS handler and the
  // bridge's result is what decides success.
  const pdfTask = () => taskWithArtifact(artifactStep({
    ext: '.pdf',
    file_path: '/proj/.anton/artifacts/report/report.pdf',
    path: '/proj/.anton/artifacts/report/report.pdf',
  }));

  it('re-checks liveness when opening fails', async () => {
    // The card may be racing a delete in another window. Rather than parse the
    // failure, ask the server again — that also covers the Electron bridge,
    // which reports { ok: false, reason } and carries no status code.
    openPath.mockResolvedValue({ ok: false, reason: 'no such file' });
    const user = userEvent.setup();
    render(<ChatView task={pdfTask()} />);

    await user.click(screen.getByRole('button', { name: 'Open' }));

    expect(revalidate).toHaveBeenCalled();
  });

  it('does not revalidate when opening succeeds', async () => {
    openPath.mockResolvedValue({ ok: true });
    const user = userEvent.setup();
    render(<ChatView task={pdfTask()} />);

    await user.click(screen.getByRole('button', { name: 'Open' }));

    expect(revalidate).not.toHaveBeenCalled();
  });
});
