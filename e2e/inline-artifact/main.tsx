// Test-only entry: a live inline artifact card and the viewer its Preview
// opens, wired as ChatView wires them (handleArtifactOpen, viewRequest,
// onChange -> setPreviewArt). The spec plays the server. Instrumentation:
// window.__inlineLog gets every preview message from either frame, every
// frame src/srcdoc change and every viewer render.
import React, { Profiler, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { ArtifactCard } from '../../src/renderer/cowork/views/ChatView.jsx';
import { ArtifactViewer } from "../../src/renderer/cowork/components/artifact/ArtifactViewer.jsx";
import '../../src/renderer/cowork/styles/tailwind.css';
import '../../src/renderer/cowork/styles/globals.css';

document.body.setAttribute('data-theme', 'light');

const w = window as any;
const t0 = performance.now();
const log: any[] = [];
w.__inlineLog = log;
const at = () => Math.round(performance.now() - t0);
const frameName = (win: any) => {
  const frames = Array.from(document.querySelectorAll('iframe'));
  const frame = frames.find((f) => f.contentWindow === win);
  if (!frame) return 'unknown';
  return frame.closest('[data-testid="artifact-inline-preview"]') ? 'inline' : 'viewer';
};
window.addEventListener('message', (event) => {
  const data = event.data;
  if (!data || typeof data !== 'object' || data.source !== 'anton-preview') return;
  const entry: any = { t: at(), dir: 'up', frame: frameName(event.source), type: data.type };
  if (data.type === 'state') entry.state = JSON.stringify(data.state);
  if (data.type === 'view') entry.inputs = (data.inputs || []).length;
  if (data.type === 'view-restored') entry.status = data.status;
  if (data.type === 'size') entry.content = data.content;
  log.push(entry);
}, true);
new MutationObserver((records) => {
  for (const r of records) {
    if (r.type === 'attributes' && (r.target as Element).tagName === 'IFRAME') {
      log.push({ t: at(), dir: 'dom', frame: frameName((r.target as HTMLIFrameElement).contentWindow), type: `iframe-${r.attributeName}` });
    }
    r.addedNodes.forEach((n: any) => {
      const frames = n.tagName === 'IFRAME' ? [n] : (n.querySelectorAll ? Array.from(n.querySelectorAll('iframe')) : []);
      frames.forEach((f: any) => log.push({ t: at(), dir: 'dom', frame: frameName(f.contentWindow), type: 'iframe-mounted' }));
    });
    r.removedNodes.forEach((n: any) => {
      if (n.tagName === 'IFRAME' || (n.querySelector && n.querySelector('iframe'))) log.push({ t: at(), dir: 'dom', type: 'iframe-removed' });
    });
  }
}).observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['src', 'srcdoc', 'style'] });

const card = {
  id: '0123456789abcdef0123456789abcdef', projectId: 'p1', slug: 'contacts', title: 'Contacts to reach', kind: 'html-app', type: 'html-app', ext: '.html',
  file_path: 'contacts/index.html', path: 'contacts/index.html', displayPath: 'contacts/index.html',
  draftUrl: `/api/v1/artifacts/drafts/p1/0123456789abcdef0123456789abcdef/${new URLSearchParams(location.search).get('page') || 'index'}.html`, display: 'inline', mtime: 1000,
};

function Host() {
  const [previewArt, setPreviewArt] = useState<any>(null);
  const [viewRequest, setViewRequest] = useState<any>(null);
  const handleArtifactOpen = (artifact: any, { view = null }: any = {}) => {
    log.push({ t: at(), dir: 'app', type: 'open', view: view ? (view as any).inputs?.length : null });
    setViewRequest(view ? { view } : null);
    setPreviewArt(artifact);
  };
  return (
    <>
      <div className="chat-transcript-col" style={{ width: 640, padding: 16 }}>
        <ArtifactCard artifact={card as any} onOpen={handleArtifactOpen} live onInlineSubmit={() => {}} />
      </div>
      <Profiler id="viewer" onRender={(_id, phase) => log.push({ t: at(), dir: 'react', type: `viewer-${phase}` })}>
        <ArtifactViewer
          open={!!previewArt}
          artifact={previewArt}
          viewRequest={viewRequest}
          onClose={() => { setPreviewArt(null); setViewRequest(null); }}
          onChange={(updated: any) => { log.push({ t: at(), dir: 'app', type: 'onChange', mtime: updated?.mtime }); setPreviewArt(updated); }}
          conversationId="t1"
          onAddressWithAgent={() => {}}
        />
      </Profiler>
    </>
  );
}

createRoot(document.getElementById('root')!).render(<Host />);
