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
const showItemInFolder = vi.fn();
const revealArtifact = vi.fn(() => Promise.resolve());
// Async on purpose — handleDownload awaits it; see the failure-path test.
const downloadArtifactFile = vi.fn(async () => true);
// A getter (not a plain property) so tests can flip web-vs-desktop per case
// without needing a whole new mock module.
let hostIsWeb = false;

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
  return { ...actual, revealArtifact: (...a) => revealArtifact(...a) };
});

vi.mock('../lib/artifactDownload', () => ({
  downloadArtifactFile: (...a) => downloadArtifactFile(...a),
}));

import ChatView, { artifactStepToCard } from './ChatView';
import { setOrgMode } from '../../lib/orgMode';

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

  it('falls back to window.open when the bridge rejects', async () => {
    /*
     * `host.openExternal` is async. A synchronous try around it returns before
     * the promise settles, so the fallback never ran on the one failure it was
     * written for and the rejection escaped unhandled.
     */
    setOrgMode(true);
    const user = userEvent.setup();
    openExternal.mockRejectedValueOnce(new Error('bridge gone'));
    const opened = vi.spyOn(window, 'open').mockImplementation(() => null);
    try {
      render(<ChatView task={taskWithArtifact(artifactStep())} />);

      await user.click(screen.getByRole('button', { name: 'Shared link' }));

      expect(opened).toHaveBeenCalledWith(PUBLISHED_URL, '_blank', 'noopener,noreferrer');
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

  it('saves a spreadsheet nobody shared, the case ENG-2044 was filed on', async () => {
    /*
     * The shipped defect, end to end: an .xlsx on web. Not previewable, not
     * publishable (autopublish is HTML/MD-only), no serve URL (org mode serves
     * no content). Six users hit "no servable file yet" on finished work in a
     * single week.
     */
    setOrgMode(true);
    const user = userEvent.setup();
    render(<ChatView task={taskWithArtifact(artifactStep({
      ext: '.xlsx',
      action: 'file',
      file_path: '/proj/.anton/artifacts/model/model.xlsx',
      path: '/proj/.anton/artifacts/model/model.xlsx',
      publishedUrl: '',
      draftUrl: `/api/v1/artifacts/drafts/proj-1/${ARTIFACT_ID}/model.xlsx`,
    }))} />);

    await user.click(screen.getByRole('button', { name: 'Download' }));
    expect(downloadArtifactFile).toHaveBeenCalledWith(
      expect.objectContaining({ draftUrl: expect.stringContaining('model.xlsx') }),
      { actionPath: '/proj/.anton/artifacts/model/model.xlsx' },
    );
    expect(screen.queryByRole('button', { name: 'Preview' })).toBeNull();
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
      ext: '.xlsx',
      action: 'file',
      file_path: '/proj/.anton/artifacts/model/model.xlsx',
      path: '/proj/.anton/artifacts/model/model.xlsx',
      publishedUrl: '',
      draftUrl: `/api/v1/artifacts/drafts/proj-1/${ARTIFACT_ID}/model.xlsx`,
    }))} />);

    await user.click(screen.getByRole('button', { name: 'Download' }));
    expect(await screen.findByText('This artifact has no downloadable file yet.')).toBeInTheDocument();
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
      ext: '.xlsx',
      action: 'spreadsheet',
      file_path: '/proj/.anton/artifacts/sales/sales.xlsx',
      path: '/proj/.anton/artifacts/sales/sales.xlsx',
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
  // A .pdf has no inline preview, so the primary button is "Show in folder"
  // (ENG-1988) and the bridge's result is what decides success.
  const pdfTask = () => taskWithArtifact(artifactStep({
    ext: '.pdf',
    file_path: '/proj/.anton/artifacts/report/report.pdf',
    path: '/proj/.anton/artifacts/report/report.pdf',
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
    const pdfTask = taskWithArtifact(artifactStep({
      ext: '.pdf',
      file_path: '/proj/.anton/artifacts/report/report.pdf',
      path: '/proj/.anton/artifacts/report/report.pdf',
    }));
    render(<ChatView task={pdfTask} />);

    expect(screen.queryByRole('button', { name: 'Show in folder' })).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Download' }));

    expect(downloadArtifactFile).toHaveBeenCalledTimes(1);
  });

  it('still offers Preview for an HTML artifact', () => {
    hostIsWeb = true;
    render(<ChatView task={taskWithArtifact(artifactStep())} />);

    expect(screen.getByRole('button', { name: 'Preview' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Download' })).toBeNull();
  });
});
