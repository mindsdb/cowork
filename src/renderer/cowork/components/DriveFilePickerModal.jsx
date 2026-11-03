import { useEffect, useRef, useState } from 'react';
import { searchGoogleDriveFiles } from '../api';
import Ico from './Icons';
import { Alert, Button, Input, Spinner } from './ui';
import { Modal, ModalBody, ModalFooter, ModalHeader } from './ui/Modal';

const SEARCH_DELAY_MS = 300;

/* Local icons by file type: the desktop app's CSP allows no remote images,
   so Drive's own iconLink can't load there. */
export function iconForMimeType(mimeType = '') {
  const m = String(mimeType || '');
  if (m.startsWith('image/') || m === 'application/vnd.google-apps.drawing') return Ico.image(14);
  if (m === 'application/vnd.google-apps.spreadsheet' || m === 'text/csv' || m.includes('spreadsheet') || m.includes('excel')) {
    return Ico.table(14);
  }
  if (m === 'application/vnd.google-apps.presentation' || m.includes('presentation') || m.includes('powerpoint')) {
    return Ico.presentation(14);
  }
  return Ico.doc(14);
}

function formatModified(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

/* The in-app Google Drive file chooser, for a connection that can read the
   whole Drive: recent files with no query, a name search otherwise. The
   server runs the Drive call, so the token never reaches this page. Resolves
   through onConfirm(files) with the DrivePickerFile shape the Google Picker
   flows return, or onClose() when dismissed. */
export default function DriveFilePickerModal({ open, connection, onConfirm, onClose }) {
  const [query, setQuery] = useState('');
  const [files, setFiles] = useState([]);
  const [nextPageToken, setNextPageToken] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [selected, setSelected] = useState(() => new Map());
  // A newer search, or the modal closing, makes an older response stale.
  const requestRef = useRef(0);
  const connectionName = connection?.name || '';

  const runSearch = async (text, pageToken) => {
    const requestId = ++requestRef.current;
    setLoading(true);
    setError('');
    try {
      const page = await searchGoogleDriveFiles(connectionName, text, pageToken);
      if (requestRef.current !== requestId) return;
      const pageFiles = Array.isArray(page?.files) ? page.files : [];
      setFiles((prev) => (pageToken ? [...prev, ...pageFiles] : pageFiles));
      setNextPageToken(page?.next_page_token || '');
    } catch (err) {
      if (requestRef.current !== requestId) return;
      setError(err?.message || 'Could not search Google Drive.');
      if (!pageToken) setFiles([]);
    } finally {
      if (requestRef.current === requestId) setLoading(false);
    }
  };

  useEffect(() => {
    if (!open) {
      requestRef.current++;
      setQuery('');
      setFiles([]);
      setNextPageToken('');
      setError('');
      setSelected(new Map());
    }
  }, [open]);

  useEffect(() => {
    if (!open || !connectionName) return undefined;
    const timer = setTimeout(() => { runSearch(query, ''); }, query ? SEARCH_DELAY_MS : 0);
    return () => clearTimeout(timer);
  }, [open, connectionName, query]);

  const toggle = (file) => {
    setSelected((prev) => {
      const next = new Map(prev);
      if (next.has(file.id)) next.delete(file.id);
      else next.set(file.id, file);
      return next;
    });
  };

  const count = selected.size;
  const accountLabel = connection?.display_name || connectionName;

  return (
    <Modal open={open} onClose={onClose} size="md" labelledBy="gdrive-file-chooser-title">
      <ModalHeader
        id="gdrive-file-chooser-title"
        title="Add files from Google Drive"
        subtitle={accountLabel ? `From ${accountLabel}` : undefined}
        onClose={onClose}
      />
      <ModalBody>
        <div className="flex flex-col gap-3">
          <Input
            value={query}
            onChange={setQuery}
            placeholder="Search your Drive by file name"
            aria-label="Search Google Drive"
            autoFocus
          />
          {error && <Alert variant="danger">{error}</Alert>}
          <div className="text-[12px] text-ink-3">{query ? 'Matching files' : 'Recently opened'}</div>
          <ul className="m-0 flex max-h-[360px] list-none flex-col gap-1 overflow-y-auto p-0" aria-label="Google Drive files">
            {files.map((f) => {
              const meta = [f.owner, formatModified(f.modifiedTime)].filter(Boolean).join(' · ');
              return (
                <li key={f.id}>
                  <label className="flex cursor-pointer items-center gap-2.5 rounded-md py-1.5 px-2 hover:bg-surface-2">
                    <input
                      type="checkbox"
                      checked={selected.has(f.id)}
                      onChange={() => toggle(f)}
                      aria-label={f.name}
                    />
                    <span className="inline-flex shrink-0 text-ink-3" aria-hidden="true">{iconForMimeType(f.mimeType)}</span>
                    <span className="flex min-w-0 flex-col">
                      <span className="truncate text-[13px] text-ink">{f.name}</span>
                      {meta && <span className="truncate text-[11.5px] text-ink-4">{meta}</span>}
                    </span>
                  </label>
                </li>
              );
            })}
          </ul>
          {loading && (
            <div className="flex items-center gap-2 text-[12px] text-ink-3">
              <Spinner className="text-ink-3" /> Searching Google Drive…
            </div>
          )}
          {!loading && !error && files.length === 0 && (
            <div className="text-[12px] italic text-ink-4">
              {query ? 'No files match that name.' : 'No files in this Drive yet.'}
            </div>
          )}
          {!loading && nextPageToken && (
            <Button variant="subtle" size="sm" className="self-start" onClick={() => runSearch(query, nextPageToken)}>
              Load more
            </Button>
          )}
        </div>
      </ModalBody>
      <ModalFooter>
        <Button variant="subtle" onClick={onClose}>Cancel</Button>
        <Button variant="primary" disabled={count === 0} onClick={() => onConfirm([...selected.values()])}>
          {count > 1 ? `Add ${count} files` : 'Add file'}
        </Button>
      </ModalFooter>
    </Modal>
  );
}
