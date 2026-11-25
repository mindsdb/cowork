// The loader the artifact viewer and the inline chat card (ENG-4684) share.
// The viewer's draft-preview suites drive it end to end through the frame;
// this pins each branch's answer directly, without a viewer around it.
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mountArtifactPreview = vi.fn();
const createDraftLink = vi.fn();
const loadArtifactDraftDocument = vi.fn();
const inlineHtmlFromApi = vi.fn();
const hostState = vi.hoisted(() => ({ isWeb: false, isElectron: true, local: true }));

vi.mock('../../api', () => ({ mountArtifactPreview: (...a) => mountArtifactPreview(...a) }));
vi.mock('../../lib/artifactWorkspaceApi', () => ({
  artifactRef: (a) => (a?.id && a?.projectId ? { projectRef: a.projectId, artifactId: a.id } : null),
  createDraftLink: (...a) => createDraftLink(...a),
  loadArtifactDraftDocument: (...a) => loadArtifactDraftDocument(...a),
}));
vi.mock('../../lib/inlineHtmlAssets', () => ({ inlineHtmlFromApi: (...a) => inlineHtmlFromApi(...a) }));
vi.mock('../../lib/draftLinkRules', () => ({
  draftLinkUrl: (link) => link.url,
  draftLinksWithdrawal: vi.fn(async () => null),
}));
vi.mock('../../../platform/host', () => ({
  host: {
    get isWeb() { return hostState.isWeb; },
    get isElectron() { return hostState.isElectron; },
    isLocalApiOrigin: () => hostState.local,
    getApiOrigin: () => (hostState.isWeb ? 'https://cowork.example' : 'http://127.0.0.1:26866'),
    checkConfigured: vi.fn(),
  },
}));

import { HtmlPreviewError, loadHtmlPreview, usesDraftLink } from './htmlPreviewSource';

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
