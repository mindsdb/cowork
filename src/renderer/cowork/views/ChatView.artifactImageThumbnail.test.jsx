// Exercise serveUrl through blob-backed thumbnail loading; CSP blocks direct loopback image
// sources.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('../../platform/host', () => ({
  host: {
    isElectron: false,
    isWeb: false,
    isMac: () => false,
    getPlatform: () => 'linux',
    getApiOrigin: () => 'http://127.0.0.1:26866',
    openPath: vi.fn(),
    openExternal: vi.fn(),
  },
  getAccessToken: vi.fn(async () => null),
  isElectron: false,
}));

import ChatView from './ChatView';

const SERVE_URL = '/api/v1/artifacts/serve/general/logo-7db94eb8/logo.png';

const imageArtifactStep = () => ({
  id: 'artifact-logo',
  label: 'MindsDB logo',
  badge: 'Artifact',
  icon: 'sparkle',
  status: 'completed',
  data: {
    title: 'MindsDB logo',
    file_path: '/proj/.anton/artifacts/logo-7db94eb8/logo.png',
    path: '/proj/.anton/artifacts/logo-7db94eb8/logo.png',
    ext: '.png',
    action: 'image',
    id: '7db94eb8',
    slug: 'logo-7db94eb8',
    publishedUrl: '',
    projectId: 'proj-1',
    projectName: 'general',
    serveUrl: SERVE_URL,
  },
});

const taskWithArtifact = (step) => ({
  id: 'conv-a',
  title: 'Alpha task',
  status: 'active',
  messages: [
    { role: 'user', content: 'build me an image of the mindsdb logo' },
    { role: 'assistant', content: 'There you go!', steps: [step] },
  ],
});

beforeEach(() => {
  // happy-dom does not implement the Blob URL registry.
  URL.createObjectURL = vi.fn(() => 'blob:mock-thumbnail');
  URL.revokeObjectURL = vi.fn();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('inline artifact banner thumbnail for an image artifact', () => {
  it('fetches the serve URL and paints a real thumbnail, not a generic icon', async () => {
    const fakeBlob = new Blob(['fake-png-bytes'], { type: 'image/png' });
    globalThis.fetch = vi.fn(async (url) => {
      expect(url.startsWith(`http://127.0.0.1:26866${SERVE_URL}`)).toBe(true);
      return { ok: true, blob: async () => fakeBlob };
    });

    render(<ChatView task={taskWithArtifact(imageArtifactStep())} />);

    const thumb = await screen.findByRole('img', { name: 'MindsDB logo' });
    expect(thumb).toHaveAttribute('src', 'blob:mock-thumbnail');
  });

  it('opening the card shows the image in the in-app preview, not just a download', async () => {
    // Generated images must retain a preview action.
    const fakeBlob = new Blob(['fake-png-bytes'], { type: 'image/png' });
    globalThis.fetch = vi.fn(async () => ({ ok: true, blob: async () => fakeBlob }));

    const user = userEvent.setup();
    render(<ChatView task={taskWithArtifact(imageArtifactStep())} />);

    await screen.findByRole('img', { name: 'MindsDB logo' });
    // ENG-1988 collapsed Open/Show-in-Finder into one button that reads
    // "Preview" for anything the in-app modal can render — images included.
    await user.click(screen.getByRole('button', { name: 'Preview' }));

    const dialog = await screen.findByRole('dialog');
    await within(dialog).findByRole('img', { name: 'MindsDB logo' });
  });
});
