// ENG-4024: an image Anton's generate_image tool wrote into the workspace
// shows inline in the chat, read through the project's files route (the
// loopback <img src> CSP workaround AttachmentThumbnail uses), and a file that
// is gone shows its name instead of a broken image.
//
// Drives the chain a live turn produces: the tool's result event, through the
// stream reducer, into the turn's steps that ChatView renders.
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
import { reduceAll } from '../lib/responseStreamAdapter';

const PROJECT = { id: 'proj-1', name: 'general', path: '/home/u/Cowork/general' };
const RAW_URL = 'http://127.0.0.1:26866/api/v1/projects/general/files-raw/images/cat.png';

const imageResult = (path = 'images/cat.png') => ({
  type: 'response.in_progress',
  thought_role: 'thought.tool_call.result',
  tool_name: 'generate_image',
  tool_use_id: 'gi_1',
  content: JSON.stringify({
    path, width: 1024, height: 1024, mime_type: 'image/png', model: 'gpt-image-2.6-flare',
    usage: { input_tokens: 16, output_tokens: 824 },
  }),
  at_ms: 20,
});

const taskWith = (events) => ({
  id: 'conv-a',
  title: 'Alpha task',
  status: 'active',
  projectId: PROJECT.id,
  messages: [
    { role: 'user', content: 'make me a picture of a cat' },
    { role: 'assistant', content: 'Here is your cat.', steps: reduceAll(events).steps },
  ],
});

beforeEach(() => {
  // happy-dom does not implement the Blob URL registry.
  URL.createObjectURL = vi.fn(() => 'blob:generated-cat');
  URL.revokeObjectURL = vi.fn();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('inline generated image', () => {
  it('reads the file from the project and shows it in the transcript', async () => {
    const fetched = [];
    globalThis.fetch = vi.fn(async (url) => {
      fetched.push(String(url));
      return { ok: true, blob: async () => new Blob(['png-bytes'], { type: 'image/png' }) };
    });

    render(<ChatView task={taskWith([imageResult()])} project={PROJECT} projects={[PROJECT]} />);

    const img = await screen.findByRole('img', { name: 'Generated image cat.png' });
    expect(img).toHaveAttribute('src', 'blob:generated-cat');
    expect(fetched).toContain(RAW_URL);
    // Above the answer text: the picture shows where it was made.
    const text = document.body.textContent;
    expect(text.indexOf('cat.png')).toBeLessThan(text.indexOf('Here is your cat.'));
  });

  it('places an absolute workspace path inside the project', async () => {
    const fetched = [];
    globalThis.fetch = vi.fn(async (url) => {
      fetched.push(String(url));
      return { ok: true, blob: async () => new Blob(['png-bytes'], { type: 'image/png' }) };
    });

    render(<ChatView task={taskWith([imageResult(`${PROJECT.path}/images/cat.png`)])} project={PROJECT} projects={[PROJECT]} />);

    await screen.findByRole('img', { name: 'Generated image cat.png' });
    expect(fetched).toContain(RAW_URL);
  });

  it('opens the picture in the file viewer', async () => {
    globalThis.fetch = vi.fn(async () => ({
      ok: true,
      headers: new Headers({ 'Content-Type': 'image/png' }),
      blob: async () => new Blob(['png-bytes'], { type: 'image/png' }),
    }));
    const user = userEvent.setup();
    render(<ChatView task={taskWith([imageResult()])} project={PROJECT} projects={[PROJECT]} />);

    await user.click(await screen.findByRole('button', { name: 'Open image: cat.png' }));

    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getAllByText(/cat\.png/).length).toBeGreaterThan(0);
  });

  it('says the image is gone instead of drawing a broken one', async () => {
    globalThis.fetch = vi.fn(async () => ({ ok: false, status: 404 }));

    render(<ChatView task={taskWith([imageResult()])} project={PROJECT} projects={[PROJECT]} />);

    expect(await screen.findByText(/could not be shown/)).toBeInTheDocument();
    expect(screen.queryByRole('img', { name: 'Generated image cat.png' })).toBeNull();
  });

  it('asks for no file outside the project', async () => {
    globalThis.fetch = vi.fn(async () => ({ ok: true, blob: async () => new Blob([]) }));

    render(<ChatView task={taskWith([imageResult('/etc/cat.png')])} project={PROJECT} projects={[PROJECT]} />);

    expect(await screen.findByText(/could not be shown/)).toBeInTheDocument();
    expect(globalThis.fetch).not.toHaveBeenCalledWith(expect.stringContaining('/etc/'), expect.anything());
  });
});
