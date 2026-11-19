/*
 * The file viewer harness page. It mounts the real ContextFileModal on one
 * uploaded file, wired as the Context card wires a task upload: read by its
 * raw URL, shown as text when it is text, with no Edit. vite.config.ts swaps
 * the app's API and authenticated fetch for stubs/, so the raw URL is a
 * fixture on this page's origin. The query names the fixture:
 * /upload.html?file=<set>/<file>.
 */
import { createRoot } from 'react-dom/client';

import ContextFileModal from '../../src/renderer/cowork/components/project/ContextFileModal';

const file = new URLSearchParams(location.search).get('file') ?? '';
const name = file.split('/').pop() ?? '';

createRoot(document.getElementById('root')!).render(
  <ContextFileModal
    open
    title={name}
    filePath={name}
    rawUrl={`/fixtures/${file}`}
    showRawText
    showEditAction={false}
    remover={null}
    onClose={() => {}}
  />,
);
