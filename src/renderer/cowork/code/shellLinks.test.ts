import { beforeEach, describe, expect, it, vi } from 'vitest';

const { openExternal, openPath, showItemInFolder } = vi.hoisted(() => ({
  openExternal: vi.fn(async () => {}),
  openPath: vi.fn(async () => ({ ok: true })),
  showItemInFolder: vi.fn<() => Promise<{ ok: boolean; reason?: string }>>(async () => ({ ok: true })),
}));

vi.mock('../../platform/host', () => ({
  host: { openExternal, openPath, showItemInFolder },
}));

import { openCodeExternalUrl, openCodePath, openCodeRepository } from './shellLinks';

beforeEach(() => {
  vi.clearAllMocks();
  showItemInFolder.mockResolvedValue({ ok: true });
});

describe('openCodeExternalUrl', () => {
  it('hands only browser URLs to the OS shell', async () => {
    await expect(openCodeExternalUrl('https://github.com/mindsdb/cowork/pull/1')).resolves.toBe(true);
    expect(openExternal).toHaveBeenCalledWith('https://github.com/mindsdb/cowork/pull/1');
  });

  it.each(['javascript:alert(1)', 'file:///Applications/Calculator.app', 'vscode://file/tmp', '', null])(
    'refuses %s without touching the shell',
    async (value) => {
      await expect(openCodeExternalUrl(value)).resolves.toBe(false);
      expect(openExternal).not.toHaveBeenCalled();
    },
  );
});

describe('openCodeRepository', () => {
  it('opens web remotes in the browser', async () => {
    await openCodeRepository('https://github.com/mindsdb/engineering-skills');
    expect(openExternal).toHaveBeenCalledWith('https://github.com/mindsdb/engineering-skills');
    expect(showItemInFolder).not.toHaveBeenCalled();
  });

  it('rewrites scp-style remotes to their web address', async () => {
    await openCodeRepository('git@github.com:mindsdb/engineering-skills.git');
    expect(openExternal).toHaveBeenCalledWith('https://github.com/mindsdb/engineering-skills');
  });

  it('reveals a local checkout in the file manager instead of executing it', async () => {
    await openCodeRepository('/Users/dev/skills');
    expect(showItemInFolder).toHaveBeenCalledWith('/Users/dev/skills');
    expect(openPath).not.toHaveBeenCalled();
    expect(openExternal).not.toHaveBeenCalled();
  });

  it('reports a path the file manager could not reveal', async () => {
    showItemInFolder.mockResolvedValue({ ok: false, reason: 'file not found' });
    await expect(openCodeRepository('/missing')).rejects.toThrow('file not found');
  });

  it('refuses an scp remote whose rewrite is not a valid web address', async () => {
    await expect(openCodeRepository('git@bad host:mindsdb/skills')).rejects.toThrow('not safe to open');
    expect(openExternal).not.toHaveBeenCalled();
    expect(openPath).not.toHaveBeenCalled();
  });
});

describe('openCodePath', () => {
  it('passes sidecar-managed paths through to the shell', async () => {
    await openCodePath('/tasks/task-1/project');
    expect(openPath).toHaveBeenCalledWith('/tasks/task-1/project');
  });
});
