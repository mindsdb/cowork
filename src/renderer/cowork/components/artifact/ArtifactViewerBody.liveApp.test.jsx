import { render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const platform = vi.hoisted(() => ({
  isWeb: true,
  isElectron: false,
  isMac: () => false,
  getApiOrigin: () => 'http://localhost',
  isLocalApiOrigin: () => false,
  openExternal: () => {},
}));
vi.mock('../../../platform/host', () => ({ host: platform }));
vi.mock('./LiveAppPreview', () => ({
  LiveAppPreview: ({ origin, launchId }) => <div data-testid="pane">{`${origin} ${launchId}`}</div>,
}));
vi.mock('./workspace/ArtifactSourceEditor', () => ({ ArtifactSourceEditor: () => null }));
vi.mock('./workspace/ArtifactComparison', () => ({ ArtifactComparison: () => null }));
vi.mock('./comments', () => ({ CommentsPanel: () => null, CommentsToolbar: () => null }));
vi.mock('./workspace/TextSelectionComment', () => ({ TextSelectionComment: () => null }));

import { ArtifactViewerBody } from './ArtifactViewerBody';

const LAUNCH = '11111111-1111-4111-8111-111111111111';
const RUNNING = { state: 'running', slot: 1, launchId: LAUNCH, address: 'http://app1.view.localhost:8080/' };
const realLocation = window.location;

function body(liveApp) {
  return <ArtifactViewerBody
    workspace={{ mode: 'preview', source: { path: 'app/index.html', contentType: 'html' }, capabilities: {}, status: 'ready', setComparison: vi.fn() }}
    preview={{ error: '', isText: false, loading: false, artifact: { path: 'app/index.html' }, textContentRef: { current: null },
      iframeRef: { current: null }, setError: vi.fn(), setIframeReady: vi.fn(), liveApp }}
    review={{ layer: { onIframeLoad: vi.fn(), anchorStates: {} }, open: false, enabled: false, controller: { threads: [] } }}
    agentReview={{ busy: false, setBusy: vi.fn() }}
  />;
}

const notice = { text: 'This live app runs at its own address.', address: RUNNING.address, canLaunch: false };

beforeEach(() => {
  // happy-dom's location is read-only; replace the descriptor for the case.
  Object.defineProperty(window, 'location', {
    configurable: true, writable: true,
    value: { protocol: 'http:', hostname: 'cowork.localhost', port: '8080', origin: 'http://cowork.localhost:8080' },
  });
  platform.isWeb = true;
});
afterEach(() => {
  Object.defineProperty(window, 'location', { configurable: true, writable: true, value: realLocation });
});

describe('a live app in the viewer pane', () => {
  it('shows a running app in the pane on the stack web UI', () => {
    render(body({ notice, state: RUNNING, reloadKey: 0, onOpen: vi.fn() }));
    expect(screen.getByTestId('pane').textContent).toBe(`http://app1.view.localhost:8080 ${LAUNCH}`);
  });

  it.each([
    ['a stopped app', { ...RUNNING, state: 'stopped' }],
    ['an app not launched yet', undefined],
    ["another person's app", { ...RUNNING, launchId: '' }],
    ['a launch at another address', { ...RUNNING, address: 'http://app2.view.localhost:8080/' }],
  ])('shows the notice, not a frame, for %s', (_, state) => {
    render(body({ notice, state, reloadKey: 0, onOpen: vi.fn() }));
    expect(screen.queryByTestId('pane')).toBeNull();
    expect(screen.getByText(notice.text)).toBeTruthy();
  });

  it('keeps the desktop app on the notice', () => {
    platform.isWeb = false;
    render(body({ notice, state: RUNNING, reloadKey: 0, onOpen: vi.fn() }));
    expect(screen.queryByTestId('pane')).toBeNull();
  });
});
