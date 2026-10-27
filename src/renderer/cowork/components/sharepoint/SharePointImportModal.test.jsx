import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  fetchSavedConnection: vi.fn(),
  listSharePointLibraries: vi.fn(),
  listSharePointChildren: vi.fn(),
  importSharePointFiles: vi.fn(),
}));

vi.mock('../../api', () => ({
  CONNECTIONS_VAULT_KEEP: 'ANTON_VAULT_KEEP',
  createSharePointConnection: vi.fn(),
  editSharePointConnection: vi.fn(),
  fetchConnector: vi.fn(),
  ...mocks,
}));

import SharePointImportModal, { PROJECT_FILES_CHANGED } from './SharePointImportModal';

const SITE = 'https://contoso.sharepoint.com/sites/team';
const file = (id, name, size = 10) => ({ id, name, size, kind: 'file', modified: null });
const folder = (id, name) => ({ id, name, size: 0, kind: 'folder', modified: null });

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

function renderModal(props = {}) {
  const onClose = vi.fn();
  const onImported = vi.fn();
  render(
    <SharePointImportModal
      open
      projectName="Sales"
      connections={[{ name: 'corp', user_label: null }]}
      onClose={onClose}
      onImported={onImported}
      {...props}
    />,
  );
  return { onClose, onImported };
}

const tree = () => screen.getByRole('tree', { name: 'SharePoint files and folders' });

beforeEach(() => {
  mocks.fetchSavedConnection.mockResolvedValue({ fields: { site_urls: SITE } });
  mocks.listSharePointLibraries.mockResolvedValue({ libraries: [{ id: 'b!Lib', name: 'Documents' }] });
  mocks.listSharePointChildren.mockImplementation(async (_name, { itemId }) => {
    if (itemId === 'root') return { items: [folder('01R', 'Reports'), file('01a', 'notes.docx', 2048)], cursor: null };
    if (itemId === '01R') return { items: [file('01q', 'q3.xlsx')], cursor: null };
    return { items: [], cursor: null };
  });
});
afterEach(() => {
  vi.resetAllMocks();
});

describe('SharePointImportModal', () => {
  it('lists the library root and expands a folder on demand', async () => {
    const user = userEvent.setup();
    renderModal();

    expect(await within(tree()).findByText('notes.docx')).toBeInTheDocument();
    expect(mocks.listSharePointLibraries).toHaveBeenCalledWith('corp', SITE);
    expect(mocks.listSharePointChildren).toHaveBeenCalledWith('corp', { site: SITE, driveId: 'b!Lib', itemId: 'root', cursor: null });
    await user.click(screen.getByRole('button', { name: 'Expand Reports' }));

    expect(await within(tree()).findByText('q3.xlsx')).toBeInTheDocument();
  });

  it('loads the next page of a folder with its cursor', async () => {
    const user = userEvent.setup();
    mocks.listSharePointChildren.mockImplementation(async (_name, { cursor }) => (
      cursor === 'p2'
        ? { items: [file('01z', 'last.txt')], cursor: null }
        : { items: [file('01a', 'first.txt')], cursor: 'p2' }
    ));
    renderModal();

    await within(tree()).findByText('first.txt');
    await user.click(screen.getByRole('button', { name: 'Load more' }));

    expect(await within(tree()).findByText('last.txt')).toBeInTheDocument();
    expect(within(tree()).getByText('first.txt')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Load more' })).toBeNull();
  });

  it('drops a page that arrives after its folder was collapsed', async () => {
    const user = userEvent.setup();
    const late = deferred();
    const fresh = deferred();
    const folderPages = [late.promise, fresh.promise];
    mocks.listSharePointChildren.mockImplementation(async (_name, { itemId }) => {
      if (itemId === 'root') return { items: [folder('01R', 'Reports')], cursor: null };
      return folderPages.shift();
    });
    renderModal();

    await user.click(await screen.findByRole('button', { name: 'Expand Reports' }));
    await user.click(screen.getByRole('button', { name: 'Collapse Reports' }));
    await user.click(screen.getByRole('button', { name: 'Expand Reports' }));
    fresh.resolve({ items: [file('01n', 'fresh.xlsx')], cursor: null });
    expect(await within(tree()).findByText('fresh.xlsx')).toBeInTheDocument();
    late.resolve({ items: [file('01q', 'stale.xlsx')], cursor: null });
    await late.promise;
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(within(tree()).queryByText('stale.xlsx')).toBeNull();
    expect(within(tree()).getByText('fresh.xlsx')).toBeInTheDocument();
    expect(mocks.listSharePointChildren).toHaveBeenCalledTimes(3);
  });

  it('stops new picks at 100', async () => {
    const many = Array.from({ length: 101 }, (_, n) => file(`01f${n}`, `f${n}.txt`));
    mocks.listSharePointChildren.mockResolvedValue({ items: many, cursor: null });
    renderModal();

    await within(tree()).findByText('f100.txt');
    // fireEvent, not userEvent: the pick logic is the subject, not pointer events.
    for (let n = 0; n < 100; n += 1) {
      fireEvent.click(screen.getByRole('checkbox', { name: `Pick f${n}.txt` }));
    }

    expect(screen.getByText(/100 of 100 picked/)).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: 'Pick f100.txt' })).toHaveAttribute('data-disabled');
    // A hundred re-renders of a 101-row tree take about 3 s on an idle machine.
  }, 20_000);

  it('imports the picks in one request, shows the result and announces the new files', async () => {
    const user = userEvent.setup();
    const changed = vi.fn();
    window.addEventListener(PROJECT_FILES_CHANGED, changed);
    mocks.importSharePointFiles.mockResolvedValue({
      imported: [{ path: 'Reports/q3.xlsx', size: 10 }, { path: 'notes.docx', size: 2048 }],
      skipped: [{ path: 'Reports/.DS_Store', reason: 'its name starts with a dot' }],
    });
    const { onImported } = renderModal();

    await user.click(await screen.findByRole('checkbox', { name: 'Pick Reports' }));
    await user.click(screen.getByRole('checkbox', { name: 'Pick notes.docx' }));
    await user.click(screen.getByRole('button', { name: 'Import into Sales' }));

    expect(await screen.findByText('Imported 2 files.')).toBeInTheDocument();
    expect(screen.getByText('Reports/.DS_Store: its name starts with a dot')).toBeInTheDocument();
    expect(mocks.importSharePointFiles).toHaveBeenCalledWith('Sales', {
      connection: 'corp', site: SITE, driveId: 'b!Lib', itemIds: ['01R', '01a'],
    });
    expect(onImported).toHaveBeenCalledTimes(1);
    expect(changed).toHaveBeenCalledTimes(1);
    expect(changed.mock.calls[0][0].detail).toEqual({ project: 'Sales' });
    window.removeEventListener(PROJECT_FILES_CHANGED, changed);
  });

  it('cannot be closed while the import runs', async () => {
    const user = userEvent.setup();
    const pending = deferred();
    mocks.importSharePointFiles.mockReturnValue(pending.promise);
    const { onClose } = renderModal();

    await user.click(await screen.findByRole('checkbox', { name: 'Pick notes.docx' }));
    await user.click(screen.getByRole('button', { name: 'Import into Sales' }));

    expect(screen.getByRole('button', { name: 'Importing…' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled();
    await user.keyboard('{Escape}');
    expect(onClose).not.toHaveBeenCalled();
    pending.resolve({ imported: [], skipped: [] });
    expect(await screen.findByText('Imported 0 files.')).toBeInTheDocument();
  });

  it.each([
    [404, "The app can't open this site. Ask your admin to grant it."],
    [404, 'Update Cowork to use SharePoint.'],
    [409, 'Reports/q3.xlsx is open in another program. Close it and import again.'],
    [413, 'This import is over the 100-file limit. Pick fewer files or folders.'],
    [422, "SharePoint returned a file name Cowork can't use: 'a/b'."],
    [429, 'SharePoint is busy right now. Try again in a minute.'],
    [500, 'The import failed and q3.xlsx couldn\'t be put back. Its old copy was kept as .cowork-import-x.bak.'],
    [502, "SharePoint couldn't be reached. Try again in a moment."],
    [504, 'The import took longer than 15 minutes. Pick fewer or smaller files.'],
    [507, "Couldn't write q3.xlsx to the project folder."],
  ])("shows the server's %s message and keeps the picks", async (status, detail) => {
    const user = userEvent.setup();
    mocks.importSharePointFiles.mockRejectedValue(Object.assign(new Error(detail), { status }));
    renderModal();

    await user.click(await screen.findByRole('checkbox', { name: 'Pick notes.docx' }));
    await user.click(screen.getByRole('button', { name: 'Import into Sales' }));

    expect(await screen.findByText(detail)).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: 'Pick notes.docx' })).toHaveAttribute('data-checked');
  });

  it('lets the person choose among several connections', async () => {
    const user = userEvent.setup();
    renderModal({ connections: [{ name: 'corp', user_label: 'Corp' }, { name: 'eu', user_label: 'EU' }] });

    await within(tree()).findByText('notes.docx');
    expect(mocks.fetchSavedConnection).toHaveBeenCalledWith('sharepoint', 'corp');
    expect(screen.getByText('Connection')).toBeInTheDocument();
  });
});
