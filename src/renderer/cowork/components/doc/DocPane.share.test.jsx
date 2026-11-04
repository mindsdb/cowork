// Opening a doc in the browser: the shared link when it is published (behind
// its access choice), else the rendered page from disk on desktop.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const state = vi.hoisted(() => ({ publishedUrl: '', isElectron: true, publishTarget: null, menuProps: null }));
const openExternal = vi.fn(async () => {});
const openPath = vi.fn(async () => ({ ok: true }));

vi.mock('./docApi');

vi.mock('../../../platform/host', () => ({
  host: {
    get isElectron() { return state.isElectron; },
    get isWeb() { return !state.isElectron; },
    openExternal: (...a) => openExternal(...a),
    openPath: (...a) => openPath(...a),
    getApiOrigin: () => 'http://localhost:1',
  },
  isElectron: true,
  isWeb: false,
}));

vi.mock('../artifact/publish/usePublish', () => ({
  usePublish: (target) => { state.publishTarget = target; return { publishedUrl: state.publishedUrl, refresh: vi.fn() }; },
}));
vi.mock('../artifact/publish/PublishMenu', () => ({
  PublishMenu: (props) => { state.menuProps = props; return <button type="button">Share</button>; },
}));

import DocPane from './DocPane';
import { fetchDoc, resetDocApi } from './docApi';

beforeEach(() => {
  resetDocApi();
  fetchDoc.mockResolvedValue({
    doc: { schema: 'cowork.doc/1', id: 'a1', title: 'Plan', rev: 2, tabs: [{ id: 't_1', title: 'Plan', blocks: [] }] },
    capabilities: { canEdit: true },
    card: { id: 'a1', title: 'Plan', format: 'doc', folder: '/p/.anton/artifacts/plan', path: '/p/.anton/artifacts/plan/doc.cdoc.json', htmlPath: '/p/.anton/artifacts/plan/doc.html' },
  });
  state.publishedUrl = '';
  state.isElectron = true;
  openExternal.mockClear();
  openPath.mockClear();
});

describe('DocPane sharing', () => {
  it('shares the rendered page, not the doc file', async () => {
    render(<DocPane projectRef="p1" artifactId="a1" />);
    expect(await screen.findByRole('button', { name: 'Share' })).toBeInTheDocument();
    expect(state.publishTarget).toMatchObject({ path: '/p/.anton/artifacts/plan/doc.html', file_path: '/p/.anton/artifacts/plan/doc.html' });
    expect(state.publishTarget.folder).toBeUndefined();
    // The server republishes the page after each save: no Update step.
    expect(state.menuProps).toMatchObject({ noun: 'doc', followsEdits: true });
  });

  it('opens the shared link once published', async () => {
    state.publishedUrl = 'https://view.mindshub.ai/view/abc/123';
    const user = userEvent.setup();
    render(<DocPane projectRef="p1" artifactId="a1" />);
    await user.click(await screen.findByRole('button', { name: 'Open the shared page' }));
    expect(openExternal).toHaveBeenCalledWith('https://view.mindshub.ai/view/abc/123');
    expect(openPath).not.toHaveBeenCalled();
  });

  it('opens the page from disk on desktop before it is shared', async () => {
    const user = userEvent.setup();
    render(<DocPane projectRef="p1" artifactId="a1" />);
    await user.click(await screen.findByRole('button', { name: 'Open in browser' }));
    expect(openPath).toHaveBeenCalledWith('/p/.anton/artifacts/plan/doc.html');
  });

  it('asks to share first on the web, where there is no file to open', async () => {
    state.isElectron = false;
    render(<DocPane projectRef="p1" artifactId="a1" />);
    expect(await screen.findByRole('button', { name: 'Open in browser' })).toBeDisabled();
  });
});
