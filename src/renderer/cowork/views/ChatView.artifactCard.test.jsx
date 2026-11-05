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
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { load } from 'js-yaml';

const FIXTURES = load(readFileSync(resolve(import.meta.dirname, '../lib/artifactSurfaces.yaml'), 'utf-8'));

const openExternal = vi.fn();
const openPath = vi.fn();
const showItemInFolder = vi.fn();
const revealArtifact = vi.fn(() => Promise.resolve());
// Async on purpose — handleDownload awaits it; see the failure-path test.
const downloadArtifactFile = vi.fn(async () => true);
/* The request the real download helper makes, for the serve-URL tests that
   run it. */
const authFetch = vi.fn();
// A getter (not a plain property) so tests can flip web-vs-desktop per case
// without needing a whole new mock module.
let hostIsWeb = false;

// Liveness is the store's business and is unit-tested there. Here we drive the
// card against a controllable answer, because what shipped broken was the CARD:
// it offered Open / Export / Show in Finder for an artifact that was gone.
const deleted = vi.fn(() => false);
const revalidate = vi.fn(() => Promise.resolve());
/* The shared document gate, stubbed per test: whether the build has the
   type's renderer and the shell supports the frame is not the card's business. */
const canPreviewDocument = vi.fn(() => false);

vi.mock('../preview/kinds', () => ({
  canPreviewDocument: (...a) => canPreviewDocument(...a),
}));

vi.mock('../lib/artifactsStore', () => ({
  useArtifactLiveness: (card, opts) => deleted(card, opts),
  setArtifactsScope: vi.fn(),
  revalidate: (...a) => revalidate(...a),
}));

vi.mock('../../platform/host', () => ({
  host: {
    isElectron: false,
    get isWeb() { return hostIsWeb; },
    isMac: () => false,
    getPlatform: () => 'linux',
    getApiOrigin: () => 'http://localhost:1',
    openPath: (...a) => openPath(...a),
    openExternal: (...a) => openExternal(...a),
    showItemInFolder: (...a) => showItemInFolder(...a),
  },
  getAccessToken: vi.fn(async () => null),
  isElectron: false,
}));

// The viewer's workspace/network behaviour is covered by its own tests. Here
// we only need to prove the inline card hands the complete artifact to it.
vi.mock('../components/artifact', () => ({
  ArtifactViewer: ({ open, artifact }) => open
    ? <div data-testid="artifact-viewer">{artifact?.id}</div>
    : null,
}));

// Partial mock: '../api' has many more exports than these tests touch
// (publishTargetPath etc., pulled in transitively by ArtifactViewer). Only
// revealArtifact — the reveal fallback when there's no working bridge —
// needs to be controllable here.
vi.mock('../api', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, revealArtifact: (...a) => revealArtifact(...a), authFetch: (...a) => authFetch(...a) };
});

vi.mock('../lib/artifactDownload', () => ({
  downloadArtifactFile: (...a) => downloadArtifactFile(...a),
}));

import ChatView, { artifactStepToCard } from './ChatView';
import { setOrgMode } from '../../lib/orgMode';
import { NO_PREVIEW_DOWNLOADED_NOTE } from '../lib/artifactActions';

const PUBLISHED_URL = 'https://view.staging.mindshub.ai/view/97901f016/845b3777';
const ARTIFACT_ID = '11111111111141118111111111111111';

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
    id: ARTIFACT_ID,
    slug: 'clock',
    artifactKey: 'artifact/11111111-1111-4111-8111-111111111111',
    draftUrl: `/api/v1/artifacts/drafts/proj-1/${ARTIFACT_ID}/index.html`,
    capabilities: { role: 'owner', canEdit: true, canComment: true },
    publishedUrl: PUBLISHED_URL,
    projectId: 'proj-1',
    projectName: 'general',
    ...overrides,
  },
});

describe('inline artifact workspace payload', () => {
  it('reaches the viewer card without dropping identity or permissions', () => {
    expect(artifactStepToCard(artifactStep(), '/proj')).toMatchObject({
      id: ARTIFACT_ID,
      artifactKey: 'artifact/11111111-1111-4111-8111-111111111111',
      draftUrl: expect.stringContaining('/artifacts/drafts/'),
      capabilities: { role: 'owner', canEdit: true, canComment: true },
    });
  });

  // ENG-2171: the line under the title is the display path, and it used to be
  // the stored path verbatim, conversation id and `.anton` folder included.
  it('shows the path below .anton/artifacts, not the storage path', () => {
    const stored = 'conversations/d4b2c4ec-2cd0-441c-a94c-e201781d9a7e/.anton/artifacts/q3-deck/index.html';
    const card = artifactStepToCard(artifactStep({ file_path: stored, path: stored }), '/proj');
    expect(card.preview).toEqual([{ heading: 'q3-deck/index.html' }]);
    expect(card.canonicalPath).toBe(`/proj/${stored}`);
  });
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
  showItemInFolder.mockReset();
  revealArtifact.mockReset();
  revealArtifact.mockResolvedValue();
  downloadArtifactFile.mockClear();
  hostIsWeb = false;
  deleted.mockReset();
  deleted.mockReturnValue(false);
  revalidate.mockClear();
  canPreviewDocument.mockReset();
  canPreviewDocument.mockReturnValue(false);
});
afterEach(() => setOrgMode(false));

describe('inline artifact banner in org mode', () => {
  it('previews in the app instead of opening a browser tab', async () => {
    /*
     * What was reported: the click opened the shared page, which for an HTML
     * artifact that happens to read like an announcement looks like the app
     * refusing to show the artifact. Every click added another tab.
     */
    setOrgMode(true);
    const user = userEvent.setup();
    render(<ChatView task={taskWithArtifact(artifactStep())} />);

    await user.click(screen.getByRole('button', { name: 'Preview' }));

    expect(screen.getByTestId('artifact-viewer')).toHaveTextContent(ARTIFACT_ID);
    expect(openExternal).not.toHaveBeenCalled();
  });

  it('keeps the shared page one click away beside the preview', async () => {
    /*
     * The published URL is the address a collaborator gets, and the chat turn
     * is where the artifact was just made.
     */
    setOrgMode(true);
    const user = userEvent.setup();
    render(<ChatView task={taskWithArtifact(artifactStep())} />);

    await user.click(screen.getByRole('button', { name: 'Shared link' }));

    expect(openExternal).toHaveBeenCalledWith(PUBLISHED_URL);
  });

  it('previews before the artifact is shared at all', async () => {
    /*
     * The draft URL carries its own access check, so the preview does not wait
     * on a publish. There is no shared page to offer yet.
     */
    setOrgMode(true);
    const user = userEvent.setup();
    render(<ChatView task={taskWithArtifact(artifactStep({ publishedUrl: '' }))} />);

    await user.click(screen.getByRole('button', { name: 'Preview' }));

    expect(screen.getByTestId('artifact-viewer')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Shared link' })).toBeNull();
  });

  it('opens the shared page for a draft it cannot render', async () => {
    /*
     * A fullstack app needs the loopback proxy only Desktop runs, so nothing
     * here can render it and the published page is the only destination left.
     */
    setOrgMode(true);
    const user = userEvent.setup();
    render(<ChatView task={taskWithArtifact(artifactStep({ type: 'fullstack-stateless-app' }))} />);

    await user.click(screen.getByRole('button', { name: 'Open' }));

    expect(openExternal).toHaveBeenCalledWith(PUBLISHED_URL);
    expect(screen.queryByTestId('artifact-viewer')).toBeNull();
  });

  it('offers no button when it can neither preview nor share', () => {
    /*
     * Nothing this card can open, and a button that only reports an error is
     * worse than none.
     */
    setOrgMode(true);
    render(<ChatView task={taskWithArtifact(artifactStep({
      type: 'fullstack-stateless-app', publishedUrl: '',
    }))} />);

    expect(screen.queryByRole('button', { name: 'Open' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Preview' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Shared link' })).toBeNull();
  });

  it('keeps Download behind "More actions" when the shared link is shown', async () => {
    // The overflow menu renders in a portal, but React bubbles its events
    // through the card, which opens the preview on click. The item must save
    // the file and nothing else.
    setOrgMode(true);
    const user = userEvent.setup();
    render(<ChatView task={taskWithArtifact(artifactStep())} />);

    expect(screen.queryByRole('button', { name: 'Download' })).toBeNull();
    await user.click(screen.getByRole('button', { name: 'More actions' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Download' }));

    expect(downloadArtifactFile).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId('artifact-viewer')).toBeNull();
  });

  it('runs a focused action on Enter without opening the preview', async () => {
    // The card opens the preview on Enter/Space. A key pressed on one of its
    // buttons must run that button and nothing else.
    setOrgMode(true);
    const user = userEvent.setup();
    render(<ChatView task={taskWithArtifact(artifactStep())} />);

    screen.getByRole('button', { name: 'Shared link' }).focus();
    await user.keyboard('{Enter}');

    expect(openExternal).toHaveBeenCalledWith(PUBLISHED_URL);
    expect(screen.queryByTestId('artifact-viewer')).toBeNull();
  });

  it('downloads from the overflow menu by keyboard without opening the preview', async () => {
    setOrgMode(true);
    const user = userEvent.setup();
    render(<ChatView task={taskWithArtifact(artifactStep())} />);

    screen.getByRole('button', { name: 'More actions' }).focus();
    await user.keyboard('{Enter}');
    const item = await screen.findByRole('menuitem', { name: 'Download' });
    item.focus();
    await user.keyboard('{Enter}');

    expect(downloadArtifactFile).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId('artifact-viewer')).toBeNull();
  });

  it('lets app shortcuts through while an action has focus', async () => {
    // Only Enter/Space stop at the action row. Cmd+K, Cmd+N and the rest are
    // window listeners and must still fire with a card button focused.
    setOrgMode(true);
    const user = userEvent.setup();
    const onKey = vi.fn();
    window.addEventListener('keydown', onKey);
    try {
      render(<ChatView task={taskWithArtifact(artifactStep())} />);

      screen.getByRole('button', { name: 'Preview' }).focus();
      await user.keyboard('{Meta>}k{/Meta}');

      expect(onKey).toHaveBeenCalledWith(expect.objectContaining({ key: 'k', metaKey: true }));
    } finally {
      window.removeEventListener('keydown', onKey);
    }
  });

  it('does not fall back to window.open when the bridge rejects', async () => {
    /*
     * host.openExternal is what restricts the agent-writable URL to safe
     * schemes, so a rejection is caught and the raw URL never reaches
     * window.open.
     */
    setOrgMode(true);
    const user = userEvent.setup();
    openExternal.mockRejectedValueOnce(new Error('bridge gone'));
    const opened = vi.spyOn(window, 'open').mockImplementation(() => null);
    try {
      render(<ChatView task={taskWithArtifact(artifactStep())} />);

      await user.click(screen.getByRole('button', { name: 'Shared link' }));

      expect(openExternal).toHaveBeenCalledWith(PUBLISHED_URL);
      expect(opened).not.toHaveBeenCalled();
    } finally {
      opened.mockRestore();
    }
  });

  it('offers Download for an image the draft cannot render but does hold (ENG-2044)', async () => {
    /*
     * The draft preview excludes images, and a .png is not publishable, so
     * before ENG-2044 this card had nowhere to go — while the server card
     * carried a perfectly good draft URL for the file. The bytes were one
     * authenticated request away the whole time; now the click saves them.
     */
    setOrgMode(true);
    const user = userEvent.setup();
    render(<ChatView task={taskWithArtifact(artifactStep({
      ext: '.png',
      action: 'image',
      file_path: '/proj/.anton/artifacts/chart/chart.png',
      path: '/proj/.anton/artifacts/chart/chart.png',
      publishedUrl: '',
      draftUrl: `/api/v1/artifacts/drafts/proj-1/${ARTIFACT_ID}/chart.png`,
    }))} />);

    expect(screen.getByLabelText('Download: Current time')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Download' }));
    expect(downloadArtifactFile).toHaveBeenCalledTimes(1);
    expect(openExternal).not.toHaveBeenCalled();
    expect(await screen.findByText(NO_PREVIEW_DOWNLOADED_NOTE, {
      selector: '.chat-artifact-card__status',
    })).toBeInTheDocument();
  });

  it('says why it has nowhere to go when there is no primary file at all', () => {
    /*
     * The only remaining dead end: no preview, nothing shared, and no draft URL
     * because the artifact has no primary file yet. "No file path" was both the
     * wrong reason and the only one the user could see; the card has a fine
     * server path and prints it.
     */
    setOrgMode(true);
    render(<ChatView task={taskWithArtifact(artifactStep({
      ext: '.png',
      action: 'image',
      file_path: '/proj/.anton/artifacts/chart/chart.png',
      path: '/proj/.anton/artifacts/chart/chart.png',
      publishedUrl: '',
      draftUrl: '',
    }))} />);

    const reason = 'This artifact cannot be previewed and has no shared link yet.';
    expect(screen.getByLabelText(reason)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Current time' })).toHaveAttribute('title', reason);
    expect(screen.queryByRole('button', { name: 'Download' })).toBeNull();
  });

  it('saves a file nobody shared, and says why once the save went through', async () => {
    /*
     * The shipped defect, end to end: a file with no preview on web. Not
     * publishable (autopublish is HTML/MD-only), no serve URL (org mode serves
     * no content). Six users hit "no servable file yet" on finished work in a
     * single week. Once the save succeeds the card says it downloaded instead.
     */
    setOrgMode(true);
    const user = userEvent.setup();
    render(<ChatView task={taskWithArtifact(artifactStep({
      ext: '.zip',
      action: 'file',
      file_path: '/proj/.anton/artifacts/model/model.zip',
      path: '/proj/.anton/artifacts/model/model.zip',
      publishedUrl: '',
      draftUrl: `/api/v1/artifacts/drafts/proj-1/${ARTIFACT_ID}/model.zip`,
    }))} />);

    await user.click(screen.getByRole('button', { name: 'Download' }));
    expect(downloadArtifactFile).toHaveBeenCalledWith(
      expect.objectContaining({ draftUrl: expect.stringContaining('model.zip') }),
      { actionPath: '/proj/.anton/artifacts/model/model.zip' },
    );
    expect(screen.queryByRole('button', { name: 'Preview' })).toBeNull();
    expect(await screen.findByText(NO_PREVIEW_DOWNLOADED_NOTE, {
      selector: '.chat-artifact-card__status',
    })).toBeInTheDocument();
  });

  it('reports the failure when the authenticated download fails', async () => {
    /*
     * Review pass 2: `downloadArtifactFile` resolves false on an expired
     * bearer / 403 / network drop. The async mock is load-bearing here —
     * with a sync mock, a dropped `await` leaves `!(Promise)` false and
     * this card would swallow the failure without a word.
     */
    setOrgMode(true);
    downloadArtifactFile.mockImplementationOnce(async () => false);
    const user = userEvent.setup();
    render(<ChatView task={taskWithArtifact(artifactStep({
      ext: '.zip',
      action: 'file',
      file_path: '/proj/.anton/artifacts/model/model.zip',
      path: '/proj/.anton/artifacts/model/model.zip',
      publishedUrl: '',
      draftUrl: `/api/v1/artifacts/drafts/proj-1/${ARTIFACT_ID}/model.zip`,
    }))} />);

    await user.click(screen.getByRole('button', { name: 'Download' }));
    // Scoped to the visible message: the same text also sits in the card's
    // screen-reader live region, which the announcement test covers.
    expect(await screen.findByText('This artifact has no downloadable file yet.', {
      selector: '.chat-artifact-card__status',
    })).toBeInTheDocument();
    expect(screen.queryByText(NO_PREVIEW_DOWNLOADED_NOTE)).toBeNull();
  });

  it('does not offer Download for an unshared fullstack app — its draft is only a shell', () => {
    // Self-review finding on ENG-2044. The card keeps the honest reason instead.
    setOrgMode(true);
    render(<ChatView task={taskWithArtifact(artifactStep({
      action: 'fullstack-stateless-app',
      type: 'fullstack-stateless-app',
      file_path: '/proj/.anton/artifacts/ops/static/index.html',
      path: '/proj/.anton/artifacts/ops/static/index.html',
      draftUrl: `/api/v1/artifacts/drafts/proj-1/${ARTIFACT_ID}/static/index.html`,
      publishedUrl: '',
    }))} />);

    expect(screen.queryByRole('button', { name: 'Download' })).toBeNull();
    expect(screen.getByLabelText('This artifact cannot be previewed and has no shared link yet.')).toBeInTheDocument();
  });

  it('offers Download beside Preview for a draft the viewer can render', () => {
    // Decision on ENG-2044: every org artifact with a primary file is saveable,
    // previewable ones included — the shared page and the preview are not
    // the file.
    setOrgMode(true);
    render(<ChatView task={taskWithArtifact(artifactStep({ publishedUrl: '' }))} />);

    expect(screen.getByRole('button', { name: 'Preview' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Download' })).toBeInTheDocument();
  });

  it('previews a markdown artifact, not only HTML', () => {
    /*
     * Every other org case here is HTML, so nothing covered the text branch of
     * the shared predicate through a real card — artifactKinds.test.js feeds it
     * hand-built objects instead. This is also the surface where the shared
     * link has to sit beside the preview rather than replace it, and only a
     * publishable type (.html or .md) ever has both at once.
     */
    setOrgMode(true);
    render(<ChatView task={taskWithArtifact(artifactStep({
      ext: '',
      action: 'report',
      file_path: '/proj/.anton/artifacts/weekly/report.md',
      path: '/proj/.anton/artifacts/weekly/report.md',
      draftUrl: `/api/v1/artifacts/drafts/proj-1/${ARTIFACT_ID}/report.md`,
    }))} />);

    expect(screen.getByRole('button', { name: 'Preview' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Shared link' })).toBeInTheDocument();
  });

  it('stays clickable when the client could not canonicalize the path', async () => {
    /*
     * Org-mode destinations are addressed by the server card, so a relative
     * path with no project folder to resolve it against must not disable the
     * preview. This is the whole reason the card asks `canActivate` rather
     * than `canAct`, and every other fixture here has an absolute path.
     */
    setOrgMode(true);
    const user = userEvent.setup();
    render(<ChatView task={{
      id: 'conv-a',
      title: 'Alpha task',
      status: 'active',
      messages: [
        { role: 'user', content: 'build me a clock' },
        {
          role: 'assistant',
          content: 'Done.',
          steps: [artifactStep({
            file_path: '.anton/artifacts/clock/index.html',
            path: '.anton/artifacts/clock/index.html',
          })],
        },
      ],
    }} />);

    expect(screen.getByRole('button', { name: 'Current time' })).toBeEnabled();

    await user.click(screen.getByRole('button', { name: 'Preview' }));

    expect(screen.getByTestId('artifact-viewer')).toBeInTheDocument();
  });

  it('does not offer a deleted artifact as openable', () => {
    /*
     * ENG-1673 again, on the deployment its test never covered. The draft URL
     * outlives the artifact, because the card is rendered from the turn's
     * persisted stream events, so the destination alone cannot answer this.
     */
    setOrgMode(true);
    deleted.mockReturnValue(true);
    render(<ChatView task={taskWithArtifact(artifactStep())} />);

    expect(screen.getByRole('button', { name: 'Current time' })).toBeDisabled();
    expect(screen.getByText('Deleted')).toBeInTheDocument();
  });
});

describe('inline artifact banner on desktop', () => {
  it('still opens the in-app preview rather than the published URL', async () => {
    // The org gate must not leak into desktop: there the local preview is the
    // point, and a published URL may exist alongside it.
    setOrgMode(false);
    const user = userEvent.setup();
    render(<ChatView task={taskWithArtifact(artifactStep())} />);

    // An HTML artifact previews in-app, so the single primary button reads
    // "Preview" rather than a generic "Open" (ENG-1988).
    await user.click(screen.getByRole('button', { name: 'Preview' }));

    expect(openExternal).not.toHaveBeenCalled();
  });
});

// ENG-1998: an image artifact (create_artifact(type="image")) rendered with a
// generic doc icon and, on the primary button, fell straight through to the
// OS file handler — canPreviewInline never recognized image extensions, so
// the card never offered an in-app preview the way it already did for
// HTML/md/txt/csv. Now that images are previewable, the ENG-1988 single-
// button model reads "Preview" for them too, same as HTML.
describe('inline artifact banner label on desktop', () => {
  /*
   * The card's accessible name follows the destination, and the third
   * destination is the OS handoff. Calling that one "Open preview" told a
   * screen reader the app was about to render the file when it was about to
   * hand it to Excel.
   */
  it('does not call the OS handoff a preview', () => {
    setOrgMode(false);
    render(<ChatView task={taskWithArtifact(artifactStep({
      ext: '.zip',
      action: 'archive',
      file_path: '/proj/.anton/artifacts/sales/sales.zip',
      path: '/proj/.anton/artifacts/sales/sales.zip',
      publishedUrl: '',
    }))} />);

    expect(screen.getByRole('button', { name: 'Current time' }))
      .toHaveAttribute('title', 'Open: Current time');
  });
});

describe('inline artifact banner for an image artifact', () => {
  const imageStep = () => artifactStep({
    ext: '.png',
    action: 'image',
    file_path: '/proj/.anton/artifacts/logo/logo.png',
    path: '/proj/.anton/artifacts/logo/logo.png',
    publishedUrl: '',
  });

  it('opens the in-app preview rather than the OS file handler', async () => {
    setOrgMode(false);
    const user = userEvent.setup();
    render(<ChatView task={taskWithArtifact(imageStep())} />);

    await user.click(screen.getByRole('button', { name: 'Preview' }));

    expect(openPath).not.toHaveBeenCalled();
    expect(openExternal).not.toHaveBeenCalled();
  });
});

describe('inline artifact banner for a deleted artifact', () => {
  it('offers none of the actions and says it is deleted', () => {
    // ENG-1673: the card stayed fully active after the artifact was deleted in
    // Live Artifacts, and Open then 404'd.
    deleted.mockReturnValue(true);
    render(<ChatView task={taskWithArtifact(artifactStep())} />);

    // This artifact is HTML, so the primary button would read "Preview" if
    // it rendered at all (ENG-1988).
    expect(screen.queryByRole('button', { name: 'Preview' })).toBeNull();
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

    expect(screen.getByRole('button', { name: 'Preview' })).toBeInTheDocument();
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
  // A .zip has no inline preview, so the primary button is "Show in folder"
  // (ENG-1988) and the bridge's result is what decides success.
  const pdfTask = () => taskWithArtifact(artifactStep({
    ext: '.zip',
    file_path: '/proj/.anton/artifacts/report/report.zip',
    path: '/proj/.anton/artifacts/report/report.zip',
  }));

  it('re-checks liveness when revealing fails', async () => {
    // The card may be racing a delete in another window. Rather than parse the
    // failure, ask the server again — that also covers the Electron bridge,
    // which reports { ok: false, reason } and carries no status code. The
    // server-side reveal fallback failing too is what actually reaches the
    // revalidate call (handleReveal tries the bridge, then the API).
    showItemInFolder.mockResolvedValue({ ok: false, reason: 'no such file' });
    revealArtifact.mockRejectedValue(new Error('not found'));
    const user = userEvent.setup();
    render(<ChatView task={pdfTask()} />);

    await user.click(screen.getByRole('button', { name: 'Show in folder' }));

    expect(revalidate).toHaveBeenCalled();
  });

  it('does not revalidate when revealing succeeds', async () => {
    showItemInFolder.mockResolvedValue({ ok: true });
    const user = userEvent.setup();
    render(<ChatView task={pdfTask()} />);

    await user.click(screen.getByRole('button', { name: 'Show in folder' }));

    expect(revalidate).not.toHaveBeenCalled();
  });
});

describe('inline artifact banner on web', () => {
  it('offers Download instead of Show in folder for a non-previewable artifact', async () => {
    // Web has no filesystem to reveal a folder in — this is the only route
    // to the file's bytes there (ENG-1988).
    hostIsWeb = true;
    const user = userEvent.setup();
    const zipTask = taskWithArtifact(artifactStep({
      ext: '.zip',
      file_path: '/proj/.anton/artifacts/report/report.zip',
      path: '/proj/.anton/artifacts/report/report.zip',
    }));
    render(<ChatView task={zipTask} />);

    expect(screen.queryByRole('button', { name: 'Show in folder' })).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Download' }));

    expect(downloadArtifactFile).toHaveBeenCalledTimes(1);
    expect(await screen.findByText(NO_PREVIEW_DOWNLOADED_NOTE, {
      selector: '.chat-artifact-card__status',
    })).toBeInTheDocument();
  });

  it('still offers Preview for an HTML artifact', () => {
    hostIsWeb = true;
    render(<ChatView task={taskWithArtifact(artifactStep())} />);

    expect(screen.getByRole('button', { name: 'Preview' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Download' })).toBeNull();
  });
});

describe('inline artifact card layout hooks', () => {
  it('groups every action in the element the container query targets', () => {
    /*
     * The card's grid and its narrow-column fallback live in globals.css and
     * key off these two class names. Layout itself is not observable here —
     * jsdom computes none — so this only guards the seam: if the actions stop
     * being one grouped child of the card, the rule that moves them onto
     * their own row below 560px silently stops applying and the filename
     * collapses to zero width again.
     */
    setOrgMode(true);
    const { container } = render(<ChatView task={taskWithArtifact(artifactStep())} />);

    const card = container.querySelector('.chat-artifact-card');
    const actions = card?.querySelector(':scope > .chat-artifact-card__actions');
    expect(actions).not.toBeNull();
    // The query container is the other half of the seam: without this
    // ancestor the @container rule can never match, and the card silently
    // keeps its three-track desktop layout at every width.
    expect(card.closest('.chat-transcript-col')).not.toBeNull();

    expect(actions).toContainElement(screen.getByRole('button', { name: 'Preview' }));
    // The secondary and the overflow trigger live in the footer's own
    // grouped element, which the grid places as the location bar's end.
    const tools = card.querySelector(':scope > .chat-artifact-card__tools');
    expect(tools).not.toBeNull();
    for (const label of ['Shared link', 'More actions']) {
      expect(tools).toContainElement(screen.getByRole('button', { name: label }));
    }
  });

  it('keeps the action status out of the button row', async () => {
    /*
     * A status message long enough to matter used to sit inside the button
     * row and squeeze the filename track next to it down to nothing. It now
     * takes a row of its own, which only works while it is a child of the
     * card rather than of the actions element.
     */
    setOrgMode(true);
    downloadArtifactFile.mockResolvedValueOnce(false);
    const user = userEvent.setup();
    const { container } = render(<ChatView task={taskWithArtifact(artifactStep())} />);

    await user.click(screen.getByRole('button', { name: 'More actions' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Download' }));

    const card = container.querySelector('.chat-artifact-card');
    const status = card.querySelector(':scope > .chat-artifact-card__status');
    expect(status).not.toBeNull();
    expect(card.querySelector('.chat-artifact-card__actions')).not.toContainElement(status);
    expect(card.querySelector('.chat-artifact-card__tools')).not.toContainElement(status);
  });

  it('announces an action result through a region that was already mounted', async () => {
    // Holding the node across the click is the point: aria-live reacts to a
    // content change, so the region has to pre-date the message.
    setOrgMode(true);
    downloadArtifactFile.mockResolvedValueOnce(false);
    const user = userEvent.setup();
    const { container } = render(<ChatView task={taskWithArtifact(artifactStep())} />);

    const live = container.querySelector('[role="status"][aria-live="polite"]');
    expect(live).not.toBeNull();
    expect(live.textContent).toBe('');
    // ARIA treats a button's non-focusable descendants as presentational, and
    // the card itself is role="button", so nesting the region would hide it.
    const card = container.querySelector('.chat-artifact-card');
    expect(card).not.toContainElement(live);

    await user.click(screen.getByRole('button', { name: 'More actions' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Download' }));

    expect(live).toHaveTextContent('This artifact has no downloadable file yet.');
    const visible = card.querySelector('.chat-artifact-card__status');
    expect(visible).not.toBeNull();
    expect(visible).not.toHaveAttribute('aria-live');
  });
});

/*
 * A file with no preview, clicked on a web host: it downloads once, and the
 * card says why only after the download went through. Every extension and
 * surface comes from artifactSurfaces.yaml.
 */
const ID = '11111111111141118111111111111111';
const fileStep = (ext, overrides = {}) => artifactStep({
  ext,
  action: 'file',
  file_path: `/proj/.anton/artifacts/data/data${ext}`,
  path: `/proj/.anton/artifacts/data/data${ext}`,
  draftUrl: `/api/v1/artifacts/drafts/proj-1/${ID}/data${ext}`,
  publishedUrl: '',
  ...overrides,
});
const cardOf = (container) => container.querySelector('.chat-artifact-card');
const clickCard = {
  'card body': (user, container) => user.click(cardOf(container)),
  'card title': (user) => user.click(screen.getByRole('button', { name: 'Current time' })),
};
const enterMode = (mode) => {
  hostIsWeb = true;
  setOrgMode(mode === 'org web');
};

describe.each(FIXTURES.webModes)('a file with no preview on %s', (mode) => {
  describe.each(FIXTURES.clickSurfaces.chatCard)('from the %s', (surface) => {
    it.each(FIXTURES.noPreviewExtensions)('downloads %s once, then shows the note', async (ext) => {
      enterMode(mode);
      const user = userEvent.setup();
      const { container } = render(<ChatView task={taskWithArtifact(fileStep(ext))} />);

      await clickCard[surface](user, container);

      expect(downloadArtifactFile).toHaveBeenCalledTimes(1);
      expect(downloadArtifactFile.mock.calls[0][0]).toMatchObject({ draftUrl: expect.stringContaining(`data${ext}`) });
      expect(await screen.findByText(NO_PREVIEW_DOWNLOADED_NOTE, {
        selector: '.chat-artifact-card__status',
      })).toBeInTheDocument();
      expect(container.querySelector('[role="status"][aria-live="polite"]'))
        .toHaveTextContent(NO_PREVIEW_DOWNLOADED_NOTE);
      expect(screen.queryByTestId('artifact-viewer')).toBeNull();
    });
  });

  it('shows the error and no note when the download fails', async () => {
    enterMode(mode);
    downloadArtifactFile.mockImplementationOnce(async () => false);
    const user = userEvent.setup();
    const { container } = render(<ChatView task={taskWithArtifact(fileStep('.zip'))} />);

    await user.click(cardOf(container));

    expect(await screen.findByText('This artifact has no downloadable file yet.', {
      selector: '.chat-artifact-card__status',
    })).toBeInTheDocument();
    expect(screen.queryByText(NO_PREVIEW_DOWNLOADED_NOTE)).toBeNull();
  });
});

/*
 * A card whose only URL is the serve URL, as a local server sends it, through
 * the real download helper with only authFetch stubbed. The note follows a
 * 2xx, and a 404 shows the error instead.
 */
describe('a file with no preview and only a serve URL on local web', () => {
  const SERVE = '/api/v1/artifacts/serve/general/data/data.zip';
  const serveOnlyStep = () => fileStep('.zip', { draftUrl: '', serveUrl: SERVE });
  let click;

  beforeEach(async () => {
    enterMode('local web');
    authFetch.mockReset();
    const actual = await vi.importActual('../lib/artifactDownload');
    downloadArtifactFile.mockImplementationOnce(actual.downloadArtifactFile);
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:artifact-file');
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
    click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
  });

  afterEach(() => vi.restoreAllMocks());

  it.each(FIXTURES.clickSurfaces.chatCard)('from the %s, saves the file after a 2xx, then shows the note', async (surface) => {
    authFetch.mockResolvedValueOnce({ ok: true, status: 200, blob: async () => new Blob(['zip']) });
    const user = userEvent.setup();
    const { container } = render(<ChatView task={taskWithArtifact(serveOnlyStep())} />);

    await clickCard[surface](user, container);

    expect(await screen.findByText(NO_PREVIEW_DOWNLOADED_NOTE, {
      selector: '.chat-artifact-card__status',
    })).toBeInTheDocument();
    expect(authFetch).toHaveBeenCalledExactlyOnceWith(`http://localhost:1${SERVE}?download=1`, { signal: undefined });
    expect(click).toHaveBeenCalledOnce();
    expect(click.mock.instances[0]).toMatchObject({ href: 'blob:artifact-file', download: 'data.zip' });
  });

  it.each(FIXTURES.clickSurfaces.chatCard)('from the %s, shows the error and no note after a 404', async (surface) => {
    authFetch.mockResolvedValueOnce({ ok: false, status: 404 });
    const user = userEvent.setup();
    const { container } = render(<ChatView task={taskWithArtifact(serveOnlyStep())} />);

    await clickCard[surface](user, container);

    expect(await screen.findByText('This artifact has no downloadable file yet.', {
      selector: '.chat-artifact-card__status',
    })).toBeInTheDocument();
    expect(authFetch).toHaveBeenCalledOnce();
    expect(screen.queryByText(NO_PREVIEW_DOWNLOADED_NOTE)).toBeNull();
    expect(click).not.toHaveBeenCalled();
  });
});

describe('a file with no preview on local web and nothing to download', () => {
  it.each([
    ['a card with no URL', { draftUrl: '', serveUrl: '' }],
    ['a fullstack app', { type: 'fullstack-stateless-app', ext: '.zip' }],
  ])('offers no Download and no note for %s', async (_name, overrides) => {
    enterMode('local web');
    const user = userEvent.setup();
    const { container } = render(<ChatView task={taskWithArtifact(fileStep('.zip', overrides))} />);

    expect(screen.queryByRole('button', { name: 'Download' })).toBeNull();
    await user.click(cardOf(container));
    await user.click(screen.getByRole('button', { name: 'Current time' }));

    expect(downloadArtifactFile).not.toHaveBeenCalled();
    expect(screen.queryByText(NO_PREVIEW_DOWNLOADED_NOTE)).toBeNull();
    expect(screen.queryByText('No artifact file path is available.')).toBeNull();
  });
});

describe.each(FIXTURES.documentPreviewExtensions)('a %s card when the document gate allows it', (ext) => {
  beforeEach(() => canPreviewDocument.mockReturnValue(true));

  it('asks the gate about this artifact', () => {
    enterMode('local web');
    render(<ChatView task={taskWithArtifact(fileStep(ext))} />);
    expect(canPreviewDocument).toHaveBeenCalledWith(
      expect.objectContaining({ ext, draftUrl: expect.stringContaining(`data${ext}`) }),
      expect.objectContaining({ isWeb: true }),
    );
  });

  it.each(FIXTURES.webModes)('opens the viewer on %s, with Download beside Preview', async (mode) => {
    enterMode(mode);
    const user = userEvent.setup();
    const { container } = render(<ChatView task={taskWithArtifact(fileStep(ext))} />);

    expect(screen.getByRole('button', { name: 'Preview' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Download' })).toBeInTheDocument();
    await user.click(cardOf(container));

    expect(screen.getByTestId('artifact-viewer')).toBeInTheDocument();
    expect(downloadArtifactFile).not.toHaveBeenCalled();
  });

  it('saves the file from the Download beside Preview, without the note', async () => {
    enterMode('local web');
    const user = userEvent.setup();
    render(<ChatView task={taskWithArtifact(fileStep(ext))} />);

    await user.click(screen.getByRole('button', { name: 'Download' }));

    expect(downloadArtifactFile).toHaveBeenCalledTimes(1);
    expect(screen.queryByText(NO_PREVIEW_DOWNLOADED_NOTE)).toBeNull();
    expect(screen.queryByTestId('artifact-viewer')).toBeNull();
  });

  it('opens the viewer on desktop, with a visible Open that hands the file to the default app', async () => {
    setOrgMode(false);
    openPath.mockResolvedValue({ ok: true });
    const user = userEvent.setup();
    const { container } = render(<ChatView task={taskWithArtifact(fileStep(ext))} />);

    await user.click(cardOf(container));
    expect(screen.getByTestId('artifact-viewer')).toBeInTheDocument();
    expect(openPath).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'Open' }));
    expect(openPath).toHaveBeenCalledWith(`/proj/.anton/artifacts/data/data${ext}`);
    expect(screen.queryByRole('button', { name: 'Download' })).toBeNull();
  });
});

describe.each(FIXTURES.documentPreviewExtensions)('a %s card when the document gate refuses it', (ext) => {
  /* A build without the type's renderer, or a desktop shell without the frame
     guard: the card treats the file as one with no preview. */
  it.each(FIXTURES.webModes)('downloads on %s, then shows the note', async (mode) => {
    enterMode(mode);
    const user = userEvent.setup();
    const { container } = render(<ChatView task={taskWithArtifact(fileStep(ext))} />);

    await user.click(cardOf(container));

    expect(downloadArtifactFile).toHaveBeenCalledTimes(1);
    expect(await screen.findByText(NO_PREVIEW_DOWNLOADED_NOTE, {
      selector: '.chat-artifact-card__status',
    })).toBeInTheDocument();
    expect(screen.queryByTestId('artifact-viewer')).toBeNull();
  });

  it('opens the default app on desktop', async () => {
    setOrgMode(false);
    openPath.mockResolvedValue({ ok: true });
    const user = userEvent.setup();
    const { container } = render(<ChatView task={taskWithArtifact(fileStep(ext))} />);

    await user.click(cardOf(container));

    expect(openPath).toHaveBeenCalledWith(`/proj/.anton/artifacts/data/data${ext}`);
    expect(downloadArtifactFile).not.toHaveBeenCalled();
    expect(screen.queryByTestId('artifact-viewer')).toBeNull();
  });
});

describe('a live-turn .xlsx card on local web', () => {
  /*
   * The reported repro: the card of a turn still streaming. It carries a draft
   * URL, so it previews when the gate allows it and downloads with the note
   * when it does not, and never dead-ends on the missing-path text.
   */
  const liveTask = () => ({
    id: 'conv-a',
    title: 'Alpha task',
    status: 'active',
    messages: [
      { role: 'user', content: 'build me a model' },
      { role: '_streaming', content: '', steps: [fileStep('.xlsx')] },
    ],
  });

  it('downloads with the note when the build has no sheet renderer', async () => {
    enterMode('local web');
    const user = userEvent.setup();
    const { container } = render(<ChatView task={liveTask()} />);

    await user.click(cardOf(container));

    expect(downloadArtifactFile).toHaveBeenCalledTimes(1);
    expect(await screen.findByText(NO_PREVIEW_DOWNLOADED_NOTE, {
      selector: '.chat-artifact-card__status',
    })).toBeInTheDocument();
    expect(screen.queryByText('No artifact file path is available.')).toBeNull();
  });

  it('previews when the gate allows it', async () => {
    enterMode('local web');
    canPreviewDocument.mockReturnValue(true);
    const user = userEvent.setup();
    const { container } = render(<ChatView task={liveTask()} />);

    await user.click(cardOf(container));

    expect(screen.getByTestId('artifact-viewer')).toBeInTheDocument();
    expect(screen.queryByText('No artifact file path is available.')).toBeNull();
  });

  /*
   * A relative path in a task with no project folder leaves the card without a
   * local path. The document preview and the download both read the card's
   * draft URL, so neither needs one.
   */
  const relativeLiveTask = () => {
    const task = liveTask();
    const relative = 'conversations/c1/.anton/artifacts/data/data.xlsx';
    task.messages[1].steps = [fileStep('.xlsx', { file_path: relative, path: relative })];
    return task;
  };

  it('previews a card with no local path when the gate allows it', async () => {
    enterMode('local web');
    canPreviewDocument.mockReturnValue(true);
    const user = userEvent.setup();
    const { container } = render(<ChatView task={relativeLiveTask()} />);

    expect(screen.getByRole('button', { name: 'Preview' })).toBeEnabled();
    await user.click(cardOf(container));

    expect(screen.getByTestId('artifact-viewer')).toBeInTheDocument();
  });

  it('downloads a card with no local path with the note when the gate refuses it', async () => {
    enterMode('local web');
    const user = userEvent.setup();
    const { container } = render(<ChatView task={relativeLiveTask()} />);

    await user.click(cardOf(container));

    expect(downloadArtifactFile).toHaveBeenCalledTimes(1);
    expect(await screen.findByText(NO_PREVIEW_DOWNLOADED_NOTE, {
      selector: '.chat-artifact-card__status',
    })).toBeInTheDocument();
  });
});
