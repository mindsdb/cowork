import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useState } from 'react';
import { useNotionPagePicker } from './useNotionPagePicker';

const apiMock = vi.hoisted(() => ({
  fetchDatasources: vi.fn(),
  fetchConnector: vi.fn(),
  startConnectorOAuth: vi.fn(),
  pollConnectorOAuth: vi.fn(),
  savePickedFiles: vi.fn(),
  fetchSavedConnection: vi.fn(),
  deletePickedFile: vi.fn(),
}));
vi.mock('../api', () => apiMock);

const hostMock = vi.hoisted(() => ({
  oauthConnect: vi.fn(),
  openExternal: vi.fn(),
  isWeb: false,
}));
vi.mock('../../platform/host', () => ({ host: hostMock }));

const NOT_CONNECTED = { connections: [] };
const CONNECTED = {
  connections: [
    { engine: 'notion', name: 'mindsdb-ws', display_name: 'MindsDB' },
    { engine: 'google_drive', name: 'user-gmail-com' },
  ],
};
const PAGE = {
  id: 'p1', title: 'ML Research', url: 'https://www.notion.so/p1', workspace: 'MindsDB', connectionName: 'mindsdb-ws',
};

function setup(initial = [], selectedProject = null) {
  return renderHook(() => {
    const [attachments, setComposerAttachments] = useState(initial);
    return { attachments, ...useNotionPagePicker({ selectedProject, setComposerAttachments }) };
  });
}

// Runs `start`, waits for the picker and picks `pages`. Returns the flow's
// promise wrapped, so awaiting this doesn't also await the flow.
async function pick(result, start, pages = [PAGE]) {
  let done;
  act(() => { done = start(); });
  await vi.waitUntil(() => result.current.notionPicker !== null);
  act(() => { result.current.resolveNotionPicker(pages); });
  return { done };
}

async function pickAndFinish(result, start, pages) {
  const { done } = await pick(result, start, pages);
  await act(() => done);
}

beforeEach(() => {
  vi.clearAllMocks();
  hostMock.isWeb = false;
  apiMock.savePickedFiles.mockResolvedValue([]);
});

describe('useNotionPagePicker', () => {
  it('opens the picker with only Notion connections and adds the chosen pages as reference chips', async () => {
    apiMock.fetchDatasources.mockResolvedValueOnce(CONNECTED);
    const { result } = setup();

    let done;
    act(() => { done = result.current.handleAddNotionPages(); });
    await vi.waitUntil(() => result.current.notionPicker !== null);
    expect(result.current.notionPicker.connections.map((c) => c.name)).toEqual(['mindsdb-ws']);
    act(() => { result.current.resolveNotionPicker([PAGE]); });
    await act(() => done);

    expect(result.current.attachments).toEqual([{
      id: 'notion-p1', source: 'notion', name: 'ML Research',
      notionPageId: 'p1', url: 'https://www.notion.so/p1', workspace: 'MindsDB',
    }]);
    expect(hostMock.oauthConnect).not.toHaveBeenCalled();
  });

  it('does not add a page twice', async () => {
    apiMock.fetchDatasources.mockResolvedValueOnce(CONNECTED);
    const existing = { id: 'notion-p1', source: 'notion', name: 'ML Research' };
    const { result } = setup([existing]);

    let done;
    act(() => { done = result.current.handleAddNotionPages(); });
    await vi.waitUntil(() => result.current.notionPicker !== null);
    act(() => { result.current.resolveNotionPicker([PAGE]); });
    await act(() => done);

    expect(result.current.attachments).toEqual([existing]);
  });

  it('cancelling the picker adds nothing', async () => {
    apiMock.fetchDatasources.mockResolvedValueOnce(CONNECTED);
    const { result } = setup();

    let done;
    act(() => { done = result.current.handleAddNotionPages(); });
    await vi.waitUntil(() => result.current.notionPicker !== null);
    act(() => { result.current.cancelNotionPicker(); });
    await act(() => done);

    expect(result.current.attachments).toEqual([]);
  });

  it('connects Notion first when it is not connected, then opens the picker', async () => {
    apiMock.fetchDatasources
      .mockResolvedValueOnce(NOT_CONNECTED)
      .mockResolvedValueOnce(CONNECTED);
    hostMock.oauthConnect.mockResolvedValueOnce({ ok: true });
    const { result } = setup();

    let done;
    act(() => { done = result.current.handleAddNotionPages(); });
    await vi.waitUntil(() => result.current.notionConnectPrompt !== null);
    act(() => { result.current.confirmNotionConnect(); });
    await vi.waitUntil(() => result.current.notionPicker !== null);
    act(() => { result.current.resolveNotionPicker([PAGE]); });
    await act(() => done);

    expect(hostMock.oauthConnect).toHaveBeenCalledWith({ engine: 'notion', name: '' });
    expect(result.current.attachments.map((a) => a.id)).toEqual(['notion-p1']);
  });

  it('declining to connect opens nothing', async () => {
    apiMock.fetchDatasources.mockResolvedValueOnce(NOT_CONNECTED);
    const { result } = setup();

    let done;
    act(() => { done = result.current.handleAddNotionPages(); });
    await vi.waitUntil(() => result.current.notionConnectPrompt !== null);
    act(() => { result.current.cancelNotionConnect(); });
    await act(() => done);

    expect(hostMock.oauthConnect).not.toHaveBeenCalled();
    expect(result.current.notionPicker).toBeNull();
  });

  it('surfaces a failed connect as an error', async () => {
    apiMock.fetchDatasources.mockResolvedValueOnce(NOT_CONNECTED);
    hostMock.oauthConnect.mockResolvedValueOnce({ ok: false, reason: 'OAuth timed out.' });
    const { result } = setup();

    let done;
    act(() => { done = result.current.handleAddNotionPages(); });
    await vi.waitUntil(() => result.current.notionConnectPrompt !== null);
    act(() => { result.current.confirmNotionConnect(); });

    await expect(done).rejects.toThrow('OAuth timed out.');
    expect(result.current.notionPicker).toBeNull();
  });
});

describe('useNotionPagePicker project files', () => {
  it('saves pages added from the chat to the project, like Drive files', async () => {
    apiMock.fetchDatasources.mockResolvedValueOnce(CONNECTED);
    const { result } = setup();

    await pickAndFinish(result, () => result.current.handleAddNotionPages('alpha'));

    expect(apiMock.savePickedFiles).toHaveBeenCalledWith('notion', 'mindsdb-ws', [
      { id: 'p1', name: 'ML Research', url: 'https://www.notion.so/p1', projects: ['alpha'] },
    ]);
    expect(result.current.attachments.map((a) => a.id)).toEqual(['notion-p1']);
  });

  it('falls back to the selected project, then to general', async () => {
    apiMock.fetchDatasources.mockResolvedValue(CONNECTED);
    const withSelected = setup([], { name: 'beta' }).result;
    await pickAndFinish(withSelected, () => withSelected.current.handleAddNotionPages());
    const withNone = setup().result;
    await pickAndFinish(withNone, () => withNone.current.handleAddNotionPages());

    expect(apiMock.savePickedFiles.mock.calls.map(([, , files]) => files[0].projects)).toEqual([['beta'], ['general']]);
  });

  it('saves each page to its own workspace connection', async () => {
    apiMock.fetchDatasources.mockResolvedValueOnce(CONNECTED);
    const other = { ...PAGE, id: 'p2', connectionName: 'other-ws' };
    const { result } = setup();

    await pickAndFinish(result, () => result.current.handleAddNotionProjectPages('alpha'), [PAGE, other]);

    expect(apiMock.savePickedFiles.mock.calls.map(([, name, files]) => [name, files.map((f) => f.id)]))
      .toEqual([['mindsdb-ws', ['p1']], ['other-ws', ['p2']]]);
  });

  it('keeps the chips but reports it when the project could not be saved', async () => {
    apiMock.fetchDatasources.mockResolvedValueOnce(CONNECTED);
    apiMock.savePickedFiles.mockRejectedValueOnce(new Error('500'));
    const { result } = setup();

    const { done } = await pick(result, () => result.current.handleAddNotionPages('alpha'));
    await act(async () => { await expect(done).rejects.toThrow('could not be saved to the project files'); });
    expect(result.current.attachments.map((a) => a.id)).toEqual(['notion-p1']);
  });

  it('adding from Project files saves the pages without touching the message', async () => {
    apiMock.fetchDatasources.mockResolvedValueOnce(CONNECTED);
    const { result } = setup();

    await pickAndFinish(result, () => result.current.handleAddNotionProjectPages('alpha'));

    expect(apiMock.savePickedFiles).toHaveBeenCalledTimes(1);
    expect(result.current.attachments).toEqual([]);
  });

  it('a failed save from Project files is an error', async () => {
    apiMock.fetchDatasources.mockResolvedValueOnce(CONNECTED);
    apiMock.savePickedFiles.mockRejectedValueOnce(new Error('Connection not found.'));
    const { result } = setup();

    const { done } = await pick(result, () => result.current.handleAddNotionProjectPages('alpha'));
    await act(async () => { await expect(done).rejects.toThrow('Connection not found.'); });
  });

  it("lists only this project's pages, with the connection each came from", async () => {
    apiMock.fetchDatasources.mockResolvedValueOnce(CONNECTED);
    apiMock.fetchSavedConnection.mockResolvedValueOnce({
      fields: {
        _picked_files: JSON.stringify([
          { id: 'p1', name: 'ML Research', url: 'u1', projects: ['alpha'] },
          { id: 'p2', name: 'Roadmap', url: 'u2', projects: ['beta'] },
        ]),
      },
    });
    const { result } = setup();

    const res = await result.current.fetchNotionProjectPages('alpha');

    expect(apiMock.fetchSavedConnection).toHaveBeenCalledWith('notion', 'mindsdb-ws');
    expect(res.files).toEqual([{ id: 'p1', name: 'ML Research', url: 'u1', projects: ['alpha'], _connectionName: 'mindsdb-ws' }]);
  });

  it('removing a page untags it from the project on its connection', async () => {
    apiMock.deletePickedFile.mockResolvedValueOnce({ ok: true });
    const { result } = setup();

    expect(await result.current.removeNotionProjectPage('p1', 'mindsdb-ws', 'alpha')).toEqual({ ok: true });
    expect(apiMock.deletePickedFile).toHaveBeenCalledWith('notion', 'mindsdb-ws', 'p1', 'alpha');
  });
});
