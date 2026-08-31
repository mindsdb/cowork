import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { FilesPanel } from './FilesPanel';


const mocks = vi.hoisted(() => ({
  resources: vi.fn(),
  entries: vi.fn(),
  file: vi.fn(),
  search: vi.fn(),
}));

vi.mock('./workspaceApi', () => ({ workspaceApi: mocks }));


describe('FilesPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.resources.mockResolvedValue({
      items: [
        { id: 'api', name: 'API', kind: 'repository' },
        { id: 'web', name: 'Web', kind: 'repository' },
      ],
    });
    mocks.entries.mockImplementation((_sessionId: string, _resourceId: string, path: string) => Promise.resolve({
      resource_id: 'api',
      path,
      truncated: false,
      items: path === 'src' ? [{
        resource_id: 'api',
        resource_name: 'API',
        path: 'src/main.py',
        name: 'main.py',
        kind: 'file',
      }] : [{
        resource_id: 'api',
        resource_name: 'API',
        path: 'src',
        name: 'src',
        kind: 'directory',
      }],
    }));
    mocks.file.mockResolvedValue({
      resource_id: 'api',
      resource_name: 'API',
      path: 'src/main.py',
      name: 'main.py',
      content: 'first\nsecond\nthird\n',
      content_hash: 'a'.repeat(64),
      line_count: 3,
      line_start: 1,
      line_end: 3,
      truncated: false,
    });
    mocks.search.mockResolvedValue({ items: [], truncated: false });
  });

  it('navigates a workspace and adds an exact line range to the prompt', async () => {
    const user = userEvent.setup();
    const onReference = vi.fn();
    render(<FilesPanel open sessionId="task-1" onClose={vi.fn()} onReference={onReference} />);

    await screen.findByRole('button', { name: 'src' });
    await user.click(screen.getByRole('button', { name: 'src' }));
    await waitFor(() => expect(mocks.entries).toHaveBeenCalledWith('task-1', 'api', 'src'));
    await screen.findByRole('button', { name: 'main.py' });
    await user.click(screen.getByRole('button', { name: 'main.py' }));

    const lines = await screen.findAllByRole('option');
    await user.click(lines[1]);
    await user.keyboard('{Shift>}');
    await user.click(lines[2]);
    await user.keyboard('{/Shift}');
    await user.click(screen.getByRole('button', { name: /Add to prompt/ }));

    expect(onReference).toHaveBeenCalledWith({
      name: 'API/src/main.py:2-3',
      path: 'api:src/main.py#L2-3',
      kind: 'mention',
      resource_id: 'api',
      relative_path: 'src/main.py',
      line_start: 2,
      line_end: 3,
      content_hash: 'a'.repeat(64),
    });
  });

  it('searches within the selected resource and opens the matching line', async () => {
    const user = userEvent.setup();
    mocks.search.mockResolvedValue({
      items: [{
        resource_id: 'api',
        resource_name: 'API',
        path: 'src/router.py',
        name: 'router.py',
        line: 42,
        preview: 'def build_route():',
        match_kind: 'content',
      }],
      truncated: false,
    });
    render(<FilesPanel open sessionId="task-1" onClose={vi.fn()} onReference={vi.fn()} />);
    await screen.findByLabelText('Search task files');

    await user.type(screen.getByLabelText('Search task files'), 'build_route');
    await screen.findByText('def build_route():');
    await user.click(screen.getByText('def build_route():'));

    expect(mocks.search).toHaveBeenCalledWith('task-1', 'build_route', 'api');
    expect(mocks.file).toHaveBeenCalledWith('task-1', 'api', 'src/router.py', 22, 221);
  });

  it('keeps the newest file when earlier reads finish out of order', async () => {
    const user = userEvent.setup();
    let resolveFirst!: (value: Record<string, unknown>) => void;
    let resolveSecond!: (value: Record<string, unknown>) => void;
    mocks.entries.mockResolvedValue({
      resource_id: 'api',
      path: '',
      truncated: false,
      items: [
        { resource_id: 'api', resource_name: 'API', path: 'first.ts', name: 'first.ts', kind: 'file' },
        { resource_id: 'api', resource_name: 'API', path: 'second.ts', name: 'second.ts', kind: 'file' },
      ],
    });
    mocks.file
      .mockImplementationOnce(() => new Promise((resolve) => { resolveFirst = resolve; }))
      .mockImplementationOnce(() => new Promise((resolve) => { resolveSecond = resolve; }));

    render(<FilesPanel open sessionId="task-1" onClose={vi.fn()} onReference={vi.fn()} />);
    await user.click(await screen.findByRole('button', { name: 'first.ts' }));
    await user.click(screen.getByRole('button', { name: 'second.ts' }));

    resolveSecond({
      resource_id: 'api', resource_name: 'API', path: 'second.ts', name: 'second.ts',
      content: 'newest\n', content_hash: 'b'.repeat(64), line_count: 1,
      line_start: 1, line_end: 1, truncated: false,
    });
    expect(await screen.findByText('newest')).toBeInTheDocument();

    resolveFirst({
      resource_id: 'api', resource_name: 'API', path: 'first.ts', name: 'first.ts',
      content: 'stale\n', content_hash: 'a'.repeat(64), line_count: 1,
      line_start: 1, line_end: 1, truncated: false,
    });
    await waitFor(() => expect(screen.queryByText('stale')).not.toBeInTheDocument());
    expect(screen.getByText('second.ts')).toBeInTheDocument();
  });
});
