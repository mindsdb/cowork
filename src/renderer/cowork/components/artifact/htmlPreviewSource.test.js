// The loader the artifact viewer and the inline chat card (ENG-4684) share.
// The viewer's draft-preview suites drive it end to end through the frame;
// this pins each branch's answer directly, without a viewer around it.
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mountArtifactPreview = vi.fn();
const createDraftLink = vi.fn();
const loadArtifactDraftDocument = vi.fn();
const loadArtifactRevision = vi.fn();
const inlineHtmlFromApi = vi.fn();
const publishedFrameCredential = vi.fn();
const hostState = vi.hoisted(() => ({ isWeb: false, isElectron: true, local: true }));

vi.mock('../../api', () => ({ mountArtifactPreview: (...a) => mountArtifactPreview(...a) }));
vi.mock('../../lib/artifactWorkspaceApi', () => ({
  artifactRef: (a) => (a?.id && a?.projectId ? { projectRef: a.projectId, artifactId: a.id } : null),
  createDraftLink: (...a) => createDraftLink(...a),
  loadArtifactDraftDocument: (...a) => loadArtifactDraftDocument(...a),
  loadArtifactRevision: (...a) => loadArtifactRevision(...a),
}));
vi.mock('../../lib/inlineHtmlAssets', () => ({ inlineHtmlFromApi: (...a) => inlineHtmlFromApi(...a) }));
vi.mock('../../lib/draftLinkRules', () => ({
  draftLinkUrl: (link) => link.url,
  draftLinksWithdrawal: vi.fn(async () => null),
}));
vi.mock('../../../lib/viewSession', () => ({
  publishedFrameCredential: (...a) => publishedFrameCredential(...a),
}));
vi.mock('../../../platform/host', () => ({
  getAccessToken: vi.fn(),
  host: {
    get isWeb() { return hostState.isWeb; },
    get isElectron() { return hostState.isElectron; },
    isLocalApiOrigin: () => hostState.local,
    getApiOrigin: () => (hostState.isWeb ? 'https://cowork.example' : 'http://127.0.0.1:26866'),
    checkConfigured: vi.fn(),
  },
}));

import { HtmlPreviewError, loadHtmlPreview, loadHtmlRevision, usesDraftLink } from './htmlPreviewSource';

const base = { actionPath: '/p/.anton/artifacts/chart/index.html', hasActionPath: true, cacheVersion: '7.0' };

beforeEach(() => {
  vi.clearAllMocks();
  Object.assign(hostState, { isWeb: false, isElectron: true, local: true });
});

describe('usesDraftLink', () => {
  it('is only for a web draft on this server with links on', () => {
    hostState.isWeb = true;
    const a = { draftUrl: '/api/v1/artifacts/drafts/p/a/index.html' };
    expect(usesDraftLink(a, true)).toBe(true);
    expect(usesDraftLink(a, false)).toBe(false);
    expect(usesDraftLink({}, true)).toBe(false);
    expect(usesDraftLink({ draftUrl: 'data:text/html,hi' }, true)).toBe(false);
    hostState.isWeb = false;
    expect(usesDraftLink(a, true)).toBe(false);
  });
});

describe('loadHtmlPreview', () => {
  it('mounts a desktop artifact by path, versioned', async () => {
    mountArtifactPreview.mockResolvedValue({ kind: 'static', url: 'http://127.0.0.1:26866/m/tok/index.html' });
    const out = await loadHtmlPreview({ ...base, artifact: { path: base.actionPath } });
    expect(mountArtifactPreview).toHaveBeenCalledWith(base.actionPath);
    expect(out).toMatchObject({ kind: 'static', doc: '', port: null, expiresAt: null });
    expect(out.url).toContain('/m/tok/index.html');
    expect(out.url).toContain('7.0');
  });

  it('says why a mount gave no URL', async () => {
    mountArtifactPreview.mockResolvedValue({ kind: 'static', url: '' });
    await expect(loadHtmlPreview({ ...base, artifact: {} })).rejects.toBeInstanceOf(HtmlPreviewError);
  });

  it('navigates to a draft on the desktop loopback without fetching it', async () => {
    const out = await loadHtmlPreview({ ...base, artifact: { draftUrl: '/api/v1/artifacts/drafts/p/a/index.html' } });
    expect(out.url.startsWith('http://127.0.0.1:26866/api/v1/artifacts/drafts/p/a/index.html')).toBe(true);
    expect(loadArtifactDraftDocument).not.toHaveBeenCalled();
    expect(mountArtifactPreview).not.toHaveBeenCalled();
  });

  it('fetches an org draft and renders it through srcdoc', async () => {
    Object.assign(hostState, { isWeb: true, isElectron: false, local: false });
    loadArtifactDraftDocument.mockResolvedValue({ isHtml: true, content: '<p>raw</p>' });
    inlineHtmlFromApi.mockResolvedValue('<p>inlined</p>');
    const out = await loadHtmlPreview({ ...base, artifact: { draftUrl: '/api/v1/artifacts/drafts/p/a/index.html' } });
    expect(out.url).toBe('');
    expect(out.doc).toContain('<p>inlined</p>');
  });

  it('opens a signed link when draft links are on, and reports when it expires', async () => {
    Object.assign(hostState, { isWeb: true, isElectron: false, local: false });
    createDraftLink.mockResolvedValue({ url: 'https://drafts.example/_t/x/index.html', expiresAt: 123 });
    const out = await loadHtmlPreview({
      ...base,
      draftLinkEnabled: true,
      artifact: { id: 'a', projectId: 'p', draftUrl: '/api/v1/artifacts/drafts/p/a/index.html' },
    });
    expect(out.url.startsWith('https://drafts.example/_t/x/index.html')).toBe(true);
    expect(out.expiresAt).toBe(123);
  });

  it('tags a refused draft link so the caller can turn links off', async () => {
    Object.assign(hostState, { isWeb: true, isElectron: false, local: false });
    const refused = Object.assign(new Error('nope'), { status: 404 });
    createDraftLink.mockRejectedValue(refused);
    const err = await loadHtmlPreview({
      ...base,
      draftLinkEnabled: true,
      artifact: { id: 'a', projectId: 'p', draftUrl: '/api/v1/artifacts/drafts/p/a/index.html' },
    }).catch((e) => e);
    expect(err).toBeInstanceOf(HtmlPreviewError);
    expect(err.stage).toBe('draft-link');
    expect(err.cause).toBe(refused);
  });

  it('returns the proxy URL and port for a fullstack app', async () => {
    mountArtifactPreview.mockResolvedValue({
      kind: 'proxy', artifactDir: '/p/app', proxyUrl: 'http://127.0.0.1:5000/', backendRunning: true, port: 5000,
    });
    const out = await loadHtmlPreview({ ...base, artifact: { type: 'fullstack-stateless-app' } });
    expect(out.kind).toBe('proxy');
    expect(out.port).toBe(5000);
  });
});

// ENG-4684: an earlier chat card opened to the page as it was.
describe('loadHtmlRevision', () => {
  const artifact = { id: 'a1', projectId: 'p', draftUrl: '/api/v1/artifacts/drafts/p/a1/index.html' };

  it("renders the revision's source with its folder files inlined", async () => {
    hostState.isWeb = true;
    loadArtifactRevision.mockResolvedValue({ id: 'r3', content: '<p>then</p>' });
    inlineHtmlFromApi.mockResolvedValue('<p>then, inlined</p>');
    const out = await loadHtmlRevision({ artifact, revisionId: 'r3' });
    expect(loadArtifactRevision).toHaveBeenCalledWith(artifact, 'r3');
    expect(inlineHtmlFromApi.mock.calls[0][0]).toBe('<p>then</p>');
    expect(out.doc).toContain('<p>then, inlined</p>');
  });

  it('fails as a preview error when the revision cannot be read', async () => {
    loadArtifactRevision.mockRejectedValue(Object.assign(new Error('gone'), { status: 404 }));
    await expect(loadHtmlRevision({ artifact, revisionId: 'r3' })).rejects.toBeInstanceOf(HtmlPreviewError);
    loadArtifactRevision.mockResolvedValue({ id: 'r3', content: '' });
    await expect(loadHtmlRevision({ artifact, revisionId: 'r3' })).rejects.toMatchObject({ stage: 'revision' });
  });
});

describe('loadHtmlPreview: a published full-stack app', () => {
  const app = { type: 'fullstack-stateful-app', path: '/p/.anton/artifacts/app/static/index.html' };
  const PUBLISHED = 'https://view.staging.mindshub.ai/a/k3m7q2xwp6n4tahd5rzc2bvy7e/';
  const ORIGIN = 'https://f5h8n2w6-staging.mindshub.co';
  const load = () => loadHtmlPreview({ ...base, hasActionPath: false, artifact: app, publishedApp: { url: PUBLISHED } });

  beforeEach(() => { Object.assign(hostState, { isWeb: true, isElectron: false, local: false }); });

  it('frames the app on its artifact host with a token, and reports when it expires', async () => {
    publishedFrameCredential.mockResolvedValue({ origin: ORIGIN, credential: 'v1.p.s', exp: 1_900_000_000 });
    expect(await load()).toEqual({
      kind: 'published', url: `${ORIGIN}/_t/v1.p.s/`, doc: '', port: null, expiresAt: 1_900_000_000,
    });
    expect(publishedFrameCredential).toHaveBeenCalledWith(PUBLISHED, expect.any(Function));
    expect(mountArtifactPreview).not.toHaveBeenCalled();
    expect(createDraftLink).not.toHaveBeenCalled();
  });

  it('versions a public app, whose responses are cached, and sets no expiry', async () => {
    publishedFrameCredential.mockResolvedValue({ origin: ORIGIN, credential: 'k3m7q2xwp6n4tahd5rzc2bvy7e', exp: null });
    const out = await load();
    expect(out.url).toBe(`${ORIGIN}/_t/k3m7q2xwp6n4tahd5rzc2bvy7e/?v=7.0`);
    expect(out.expiresAt).toBeNull();
  });

  it.each(['no_access', 'password', 'update_needed', 'retry', 'unavailable'])('fails with the reason %s', async (reason) => {
    publishedFrameCredential.mockResolvedValue({ error: reason });
    const error = await load().catch((e) => e);
    expect(error).toBeInstanceOf(HtmlPreviewError);
    expect(error.stage).toBe('published');
    expect(error.reason).toBe(reason);
    expect(error.message).not.toBe('');
  });

  it('says it shows once published, and asks nothing, without an https address', async () => {
    for (const url of ['', 'javascript:alert(1)']) {
      const error = await loadHtmlPreview({ ...base, hasActionPath: false, artifact: app, publishedApp: { url } }).catch((e) => e);
      expect(error.stage).toBe('published');
      expect(error.reason).toBe('');
    }
    expect(publishedFrameCredential).not.toHaveBeenCalled();
  });
});
