// The Artifacts page's Share dialog seeds its choice from the artifact, apart
// from the viewer's panel, so it gets its own check through the real page.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';

// A web build without the platform UI whose page has no SPA wrapper
// publish-token tag, which keeps the shared-token choices: no "Only me", and
// Public says "Anyone with the URL".
vi.mock('../../lib/deployment', () => ({ PLATFORM_UI: false }));
vi.mock('../api', () => ({
  revealArtifact: vi.fn(),
  publishArtifact: vi.fn(),
  unpublishArtifact: vi.fn(),
  updateArtifact: vi.fn(),
  deleteArtifact: vi.fn(),
  publishTargetPath: vi.fn((a) => a.path),
  artifactServeUrl: vi.fn(() => ''),
  openArtifactFile: vi.fn(),
}));
vi.mock('../../platform/host', () => ({
  host: {
    isWeb: true, isMac: () => false, isElectron: false, openExternal: vi.fn(),
    getApiOrigin: () => 'https://cowork.example',
  },
  // The people field reads who is signed in (useAccountUser): nobody here.
  getAccessToken: vi.fn(async () => null),
}));
vi.mock('../lib/analytics', () => ({ trackArtifactPublished: vi.fn() }));
const toast = vi.hoisted(() => ({ add: vi.fn() }));
vi.mock('../components/ui/Toast', () => ({ useToastManager: () => toast }));
vi.mock('../components/artifact', () => ({ ArtifactViewer: () => null }));

import ArtifactsView from './ArtifactsView';
import * as api from '../api';
import { OWNED_BY_OTHER_USER_MESSAGE } from '../components/artifact/publish/publishErrors';

const unpublished = {
  id: 'a1', path: '/proj/.anton/artifacts/share-test/index.html',
  title: 'share test', type: 'html-app', mtime: 2000,
  publishedUrl: '',
};

afterEach(() => {
  localStorage.clear();
  vi.clearAllMocks();
});

function openShareDialog() {
  fireEvent.click(screen.getByLabelText('Artifact menu'));
  fireEvent.click(screen.getByText('Share'));
  return screen.getByRole('dialog');
}

describe.each([
  ['grid', 'grid'],
  ['list', 'list'],
])('%s view Share dialog with the platform UI off and no publish-token tag', (_name, view) => {
  it('opens with nothing picked and keeps Share disabled', () => {
    localStorage.setItem('anton:artifacts-view', view);
    render(<ArtifactsView artifacts={[unpublished]} />);
    const dialog = openShareDialog();

    for (const radio of within(dialog).getAllByRole('radio')) {
      expect(radio).toHaveAttribute('aria-checked', 'false');
    }
    expect(within(dialog).queryByText('Only me')).toBeNull();
    const share = within(dialog).getByRole('button', { name: 'Share' });
    expect(share).toBeDisabled();
    fireEvent.click(share);
    expect(api.publishArtifact).not.toHaveBeenCalled();
  });

  /* The button names the choice it shares with: the dialog's draft carries
     the chooser's own values (AUDIENCE_CHOICE), not the wire mode. */
  it('names a share with specific people, and a password share, on its button', () => {
    localStorage.setItem('anton:artifacts-view', view);
    render(<ArtifactsView artifacts={[unpublished]} />);
    const dialog = openShareDialog();

    fireEvent.click(within(dialog).getByRole('radio', { name: /Specific people/ }));
    expect(within(dialog).getByRole('button', { name: 'Share restricted' })).toBeInTheDocument();

    fireEvent.click(within(dialog).getByRole('radio', { name: /Password protected/ }));
    expect(within(dialog).getByRole('button', { name: 'Share protected' })).toBeInTheDocument();
  });

  /* The card takes the audience the publish answer names, and the
     request's for each field the answer leaves out. */
  async function shareWithPeople(onArtifactChanged, answer) {
    api.publishArtifact.mockResolvedValue(answer);
    localStorage.setItem('anton:artifacts-view', view);
    render(<ArtifactsView artifacts={[unpublished]} onArtifactChanged={onArtifactChanged} />);
    const dialog = openShareDialog();
    fireEvent.click(within(dialog).getByRole('radio', { name: /Specific people/ }));
    const field = within(dialog).getByRole('combobox', { name: 'Add people by email' });
    fireEvent.change(field, { target: { value: 'ana@partner.io' } });
    fireEvent.keyDown(field, { key: 'Enter' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Share restricted' }));
    await waitFor(() => expect(onArtifactChanged).toHaveBeenCalled());
    expect(api.publishArtifact).toHaveBeenCalledWith(unpublished.path, {
      mode: 'restricted', emails: ['ana@partner.io'], org_allowed: false, owner_only: false,
    });
    return onArtifactChanged.mock.calls.at(-1)[0];
  }

  it('keeps the people it shared with when the answer names none', async () => {
    const card = await shareWithPeople(vi.fn(), { url: 'https://share/a1', accessMode: 'restricted' });

    expect(card).toMatchObject({
      publishedUrl: 'https://share/a1', accessMode: 'restricted',
      accessEmails: ['ana@partner.io'], orgAllowed: false, ownerOnly: false,
    });
  });

  it('takes the audience the answer names over the request', async () => {
    const card = await shareWithPeople(vi.fn(), {
      url: 'https://share/a1', accessMode: 'restricted', accessEmails: ['bo@partner.io'], ownerOnly: true,
    });

    expect(card).toMatchObject({ accessEmails: ['bo@partner.io'], orgAllowed: false, ownerOnly: true });
  });

  it('opens with nothing picked even when an earlier publish left Public on it', () => {
    localStorage.setItem('anton:artifacts-view', view);
    render(<ArtifactsView artifacts={[{ ...unpublished, accessMode: 'public' }]} />);
    const dialog = openShareDialog();

    expect(within(dialog).getByRole('radio', { name: /Public/ })).toHaveAttribute('aria-checked', 'false');
    expect(within(dialog).getByRole('button', { name: 'Share' })).toBeDisabled();
  });

  /* What `req()` throws for cowork-server's 403 share_org_required: MindsHub's
     reason as the message and the code beside it. Asking again gets the same
     answer, so the card keeps its state and offers no Try again. */
  const REASON = 'Sharing an artifact with everyone in the organization needs the artifacts.share_org permission.';
  const refused = () => Object.assign(new Error(REASON), { status: 403, code: 'share_org_required' });

  async function sharePublicly() {
    localStorage.setItem('anton:artifacts-view', view);
    render(<ArtifactsView artifacts={[unpublished]} />);
    const dialog = openShareDialog();
    fireEvent.click(within(dialog).getByRole('radio', { name: /Public/ }));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Share' }));
    await waitFor(() => expect(toast.add).toHaveBeenCalledTimes(1));
    return toast.add.mock.calls[0][0];
  }

  /* What `req()` throws for cowork-server's 409 artifact_owned_by_other_user:
     the server's sentence as the message and the code beside it. Asking again
     gets the same answer here too. */
  const ownedElsewhere = () => Object.assign(
    new Error(OWNED_BY_OTHER_USER_MESSAGE),
    { status: 409, code: 'artifact_owned_by_other_user' },
  );

  it.each([
    ['a share with everyone the caller may not make', refused, REASON],
    ["another owner's artifact", ownedElsewhere, OWNED_BY_OTHER_USER_MESSAGE],
  ])("shows a refused share's reason once and offers no Try again: %s", async (_name, error, message) => {
    api.publishArtifact.mockRejectedValue(error());

    expect(await sharePublicly()).toEqual({ title: message, type: 'danger' });
    expect(screen.queryByText('Sharing failed')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull();
    expect(screen.getByText('Not shared')).toBeInTheDocument();
  });

  it('keeps Sharing failed and Try again for a failure asking again can help', async () => {
    api.publishArtifact.mockRejectedValue(Object.assign(new Error('Publishing failed: upload timed out'), { status: 502, code: null }));

    expect(await sharePublicly()).toEqual({ title: 'Sharing failed: Publishing failed: upload timed out', type: 'danger' });
    expect(screen.getByText('Sharing failed')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
  });

  it("shows a refused update's reason once", async () => {
    api.updateArtifact.mockRejectedValue(refused());
    localStorage.setItem('anton:artifacts-view', view);
    const published = { ...unpublished, publishedUrl: 'https://share/a1', accessMode: 'restricted', accessEmails: [], orgAllowed: true, ownerOnly: false, modified: true };
    render(<ArtifactsView artifacts={[published]} />);
    fireEvent.click(screen.getByLabelText('Artifact menu'));
    fireEvent.click(screen.getByText('Update'));

    await waitFor(() => expect(toast.add).toHaveBeenCalledWith({ title: REASON, type: 'danger' }));
  });
});
