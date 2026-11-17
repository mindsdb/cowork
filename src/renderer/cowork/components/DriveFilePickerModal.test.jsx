import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const apiMock = vi.hoisted(() => ({ searchGoogleDriveFiles: vi.fn() }));
vi.mock('../api', () => apiMock);

import DriveFilePickerModal, { iconForMimeType } from './DriveFilePickerModal';
import Ico from './Icons';

const CONNECTION = { name: 'user-gmail-com', display_name: 'user@gmail.com' };
const file = (id, name) => ({ id, name, mimeType: 'application/pdf', iconUrl: null, url: `https://drive/${id}` });

function renderModal(props = {}) {
  const onConfirm = vi.fn();
  const onClose = vi.fn();
  render(<DriveFilePickerModal open connection={CONNECTION} onConfirm={onConfirm} onClose={onClose} {...props} />);
  return { onConfirm, onClose };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('DriveFilePickerModal', () => {
  it('lists recently opened files first, without a query', async () => {
    apiMock.searchGoogleDriveFiles.mockResolvedValueOnce({ files: [file('f1', 'Roadmap')], next_page_token: '' });
    renderModal();

    expect(await screen.findByRole('checkbox', { name: 'Roadmap' })).toBeInTheDocument();
    expect(apiMock.searchGoogleDriveFiles).toHaveBeenCalledWith('user-gmail-com', '', '');
    expect(screen.getByText('Recently opened')).toBeInTheDocument();
  });

  it('searches by name as the user types', async () => {
    apiMock.searchGoogleDriveFiles
      .mockResolvedValueOnce({ files: [], next_page_token: '' })
      .mockResolvedValue({ files: [file('f2', 'Budget 2026')], next_page_token: '' });
    renderModal();
    await waitFor(() => expect(apiMock.searchGoogleDriveFiles).toHaveBeenCalledTimes(1));

    await userEvent.type(screen.getByRole('textbox', { name: 'Search Google Drive' }), 'budget');

    expect(await screen.findByRole('checkbox', { name: 'Budget 2026' })).toBeInTheDocument();
    expect(apiMock.searchGoogleDriveFiles).toHaveBeenLastCalledWith('user-gmail-com', 'budget', '');
  });

  it('adds the chosen files, and nothing until one is chosen', async () => {
    apiMock.searchGoogleDriveFiles.mockResolvedValueOnce({
      files: [file('f1', 'Roadmap'), file('f2', 'Budget')], next_page_token: '',
    });
    const { onConfirm } = renderModal();
    await screen.findByRole('checkbox', { name: 'Roadmap' });

    expect(screen.getByRole('button', { name: 'Add file' })).toBeDisabled();
    await userEvent.click(screen.getByRole('checkbox', { name: 'Roadmap' }));
    await userEvent.click(screen.getByRole('checkbox', { name: 'Budget' }));
    await userEvent.click(screen.getByRole('button', { name: 'Add 2 files' }));

    expect(onConfirm).toHaveBeenCalledWith([file('f1', 'Roadmap'), file('f2', 'Budget')]);
  });

  it('loads the next page onto the list', async () => {
    apiMock.searchGoogleDriveFiles
      .mockResolvedValueOnce({ files: [file('f1', 'Roadmap')], next_page_token: 'p2' })
      .mockResolvedValueOnce({ files: [file('f3', 'Notes')], next_page_token: '' });
    renderModal();
    await screen.findByRole('checkbox', { name: 'Roadmap' });

    await userEvent.click(screen.getByRole('button', { name: 'Load more' }));

    expect(await screen.findByRole('checkbox', { name: 'Notes' })).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: 'Roadmap' })).toBeInTheDocument();
    expect(apiMock.searchGoogleDriveFiles).toHaveBeenLastCalledWith('user-gmail-com', '', 'p2');
    expect(screen.queryByRole('button', { name: 'Load more' })).not.toBeInTheDocument();
  });

  it("shows the server's reason when Drive refuses the search", async () => {
    apiMock.searchGoogleDriveFiles.mockRejectedValueOnce(
      new Error('Google Drive refused the search. Reconnect Google Drive and allow "See and download all your Google Drive files".'),
    );
    renderModal();

    expect(await screen.findByText(/Reconnect Google Drive and allow/)).toBeInTheDocument();
  });

  it('does not search while closed', () => {
    renderModal({ open: false });
    expect(apiMock.searchGoogleDriveFiles).not.toHaveBeenCalled();
  });
});

describe('iconForMimeType', () => {
  it.each([
    ['application/vnd.google-apps.document', 'doc'],
    ['application/pdf', 'doc'],
    ['application/vnd.google-apps.spreadsheet', 'table'],
    ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'table'],
    ['text/csv', 'table'],
    ['application/vnd.google-apps.presentation', 'presentation'],
    ['application/vnd.openxmlformats-officedocument.presentationml.presentation', 'presentation'],
    ['image/png', 'image'],
    [undefined, 'doc'],
  ])('maps %s to the %s icon', (mime, icon) => {
    expect(iconForMimeType(mime)).toEqual(Ico[icon](14));
  });

  it('never renders a remote image, which the desktop CSP would block', async () => {
    apiMock.searchGoogleDriveFiles.mockResolvedValueOnce({
      files: [{ ...file('f1', 'Roadmap'), iconUrl: 'https://drive-thirdparty.googleusercontent.com/16/type/application/pdf' }],
      next_page_token: '',
    });
    renderModal();
    await screen.findByRole('checkbox', { name: 'Roadmap' });
    expect(document.querySelector('img')).toBeNull();
  });
});
