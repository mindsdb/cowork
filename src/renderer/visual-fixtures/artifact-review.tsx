import { StrictMode, useState } from 'react';
import { createRoot } from 'react-dom/client';

import '../cowork/styles/globals.css';
import '../cowork/styles/skin-8bit.css';
import '../styles.css';
import '../cowork/styles/tailwind.css';
import { ArtifactViewer } from '../cowork/components/artifact';
import type { ArtifactViewerArtifact } from '../cowork/components/artifact';
import { ToastProvider } from '../cowork/components/ui/Toast';
import { ChatTranscriptContext } from '../cowork/lib/chatTranscriptContext';
import { ModelPickerContext } from '../cowork/lib/modelPickerContext';

const MARKDOWN = `# Q3 launch readiness

The launch plan is on track, with the remaining work concentrated in reviewer access and the final export pass.

## Decisions

- Keep the artifact as the primary working surface.
- Let reviewers comment without learning the project structure.
- Show every manual and agent change as a revision that can be compared and undone.

## Open questions

The public-link reporting policy still needs an owner decision before rollout.
`;

const HTML_SLIDES = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <style>
    * { box-sizing: border-box; }
    html, body { width: 100%; height: 100%; margin: 0; }
    body { font-family: Inter, system-ui, sans-serif; background: #07111f; color: #f5fbff; }
    .slide { min-height: 100%; padding: 8vh 8vw; display: grid; grid-template-rows: auto 1fr auto; background: radial-gradient(circle at 82% 14%, #12455b 0, transparent 34%), linear-gradient(135deg, #07111f, #0c192a); }
    .kicker { color: #43d8ef; letter-spacing: .18em; text-transform: uppercase; font-size: clamp(11px, 1.4vw, 18px); font-weight: 700; }
    .hero { align-self: center; max-width: 900px; }
    h1 { margin: 0 0 3vh; font-size: clamp(50px, 8vw, 112px); line-height: .92; letter-spacing: -.055em; }
    p { margin: 0; max-width: 760px; color: #b9c9d8; font-size: clamp(17px, 2.25vw, 30px); line-height: 1.35; }
    footer { display: flex; justify-content: space-between; color: #6f879b; font: 600 12px/1.2 ui-monospace, monospace; letter-spacing: .08em; text-transform: uppercase; }
  </style>
</head>
<body>
  <main class="slide">
    <div class="kicker">Q3 product review</div>
    <section class="hero">
      <h1>Artifacts, finished.</h1>
      <p>Move naturally from a private draft to inline editing, collaborative feedback, and a reviewed agent fix.</p>
    </section>
    <footer><span>MindsHub Cowork</span><span>01 / 06</span></footer>
  </main>
</body>
</html>`;

const SEARCH_PARAMS = new URLSearchParams(window.location.search);
const IS_HTML_SLIDES = SEARCH_PARAMS.get('artifact') === 'slides';
// `?owner=unknown` is what the server sends for an artifact nobody is recorded
// as owning (ENG-2961): role 'reviewer' plus ownerUnknown (ENG-2979 tag).
const IS_OWNER_UNKNOWN = SEARCH_PARAMS.get('owner') === 'unknown';
const IS_REVIEWER = SEARCH_PARAMS.get('role') === 'reviewer' || IS_OWNER_UNKNOWN;
const OWNER_UNKNOWN_CAPABILITIES = IS_OWNER_UNKNOWN ? { ownerUnknown: true } : {};
const IS_DESKTOP = SEARCH_PARAMS.get('deployment') === 'desktop';
// `?comments=down`: the owner's comments-access answers 503, as a review
// service that is down does.
const IS_COMMENTS_DOWN = SEARCH_PARAMS.get('comments') === 'down';
// `?quickEdit=1`: the server offers quick edits (ENG-4227), and the bar's
// request streams a direct edit that lands as a new revision.
const QUICK_EDIT_CAPABILITIES = SEARCH_PARAMS.get('quickEdit') === '1' && !(SEARCH_PARAMS.get('role') === 'reviewer' || SEARCH_PARAMS.get('owner') === 'unknown')
  ? { canQuickEdit: true, quickEditDirect: SEARCH_PARAMS.get('direct') !== 'off' }
  : {};
const PROJECT_REF = IS_DESKTOP ? 'local' : '11111111-1111-1111-1111-111111111111';
const INITIAL_CONTENT = IS_HTML_SLIDES ? HTML_SLIDES : MARKDOWN;
const ARTIFACT_FILENAME = IS_HTML_SLIDES ? 'artifact-collaboration-slides.html' : 'Q3-launch-readiness.md';

function htmlPreviewUrl(content: string) {
  return `data:text/html;charset=utf-8,${encodeURIComponent(content)}`;
}

const originalFetch = window.fetch.bind(window);
// One identity: `metadata.json` and the workspace API spell it as bare hex, the
// comments key as the canonical dashed UUID.
const ARTIFACT_ID = 'aaaaaaaaaaaa4aaa8aaaaaaaaaaaaaaa';
const ARTIFACT_KEY = 'artifact/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const REVISION = {
  id: 'rev-current',
  number: 4,
  artifactId: ARTIFACT_ID,
  path: ARTIFACT_FILENAME,
  createdAt: '2026-08-25T12:30:00+00:00',
  actor: { kind: 'manual', id: 'fixture-user' },
  summary: 'Clarified launch decisions',
  contentHash: 'fixture-hash',
};
let currentContent = INITIAL_CONTENT;
let currentRevision = REVISION;
let commentStatus = 'open';
let repairQueued = false;
const PREVIOUS = {
  ...REVISION,
  id: 'rev-previous',
  number: 3,
  summary: 'Added open questions',
  content: IS_HTML_SLIDES
    ? HTML_SLIDES.replace('Artifacts, finished.', 'Artifacts, underway.')
    : MARKDOWN.replace('The launch plan is on track', 'The launch plan needs work'),
};
const AGENT_CONTENT = IS_HTML_SLIDES
  ? HTML_SLIDES.replace(
    'Move naturally from a private draft to inline editing, collaborative feedback, and a reviewed agent fix.',
    'Recipients can report issues, while owners compare and approve every agent fix.',
  )
  : MARKDOWN.replace(
    'The public-link reporting policy still needs an owner decision before rollout.',
    'Public-link recipients can report issues after signing in, while only the owner can resolve them.',
  );
const COMMENT = {
  id: 'comment-reviewer-1',
  artifact_id: ARTIFACT_KEY,
  selector: null,
  status: commentStatus,
  version: 1,
  created_at: '2026-08-25T12:40:00+00:00',
  updated_at: '2026-08-25T12:40:00+00:00',
  payload: {
    author: { user_id: 'reviewer-user', email: 'reviewer@example.com' },
    text: IS_HTML_SLIDES
      ? 'Please make the collaboration outcome more explicit on this slide.'
      : 'Please make the public-link reporting decision explicit.',
    revision_id: 'rev-current',
    kind: 'issue',
    replies: [{
      id: 'reply-owner-1',
      author: { user_id: 'fixture-user', email: 'ian@example.com' },
      text: 'I’ll address this with the agent.',
      created_at: '2026-08-25T12:42:00+00:00',
    }],
  },
};
window.fetch = async (input, init) => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  if (url.includes('/api/v1/artifacts/preview?')) {
    return new Response('Cloud preview paths must not use the desktop-only endpoint', { status: 501 });
  }
  if (url.includes(`/api/v1/artifacts/drafts/${PROJECT_REF}/${ARTIFACT_ID}/`)) {
    return new Response(currentContent, {
      status: 200,
      headers: { 'Content-Type': IS_HTML_SLIDES ? 'text/html' : 'text/markdown' },
    });
  }
  if (url.includes('/api/v1/artifacts/status?')) {
    // `?published=1`: a published page, for the header's address pill.
    const publishedUrl = SEARCH_PARAMS.get('published') === '1'
      ? 'https://view-pr-cowork-1422.dev.mindshub.ai/p/artifact-collaboration-slides-a1b2c3d4'
      : '';
    return new Response(JSON.stringify({ publishedUrl, accessMode: publishedUrl ? 'public' : 'private', artifactKey: ARTIFACT_KEY }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }
  if (url.includes(`/api/v1/artifacts/workspace/${PROJECT_REF}/${ARTIFACT_ID}/comments-access`)) {
    if (IS_COMMENTS_DOWN) {
      return new Response(JSON.stringify({ detail: 'Could not authorize draft collaboration' }), {
        status: 503,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    return new Response(JSON.stringify({
      enabled: true,
      artifactKey: ARTIFACT_KEY,
      capabilities: {
        role: IS_REVIEWER ? 'reviewer' : 'owner',
        canPreview: true,
        canComment: true,
        canEdit: !IS_REVIEWER,
        canAddressWithAgent: !IS_REVIEWER,
        canResolveComments: !IS_REVIEWER,
        ...OWNER_UNKNOWN_CAPABILITIES,
        ...QUICK_EDIT_CAPABILITIES,
      },
      currentRevision,
    }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }
  if (url.endsWith('/quick-edits/quick-edit-fixture-1/undo')) {
    // Slow enough to see the bar's undo in progress.
    await new Promise((resolve) => { setTimeout(resolve, 1500); });
    currentContent = INITIAL_CONTENT;
    currentRevision = { ...REVISION, id: 'rev-undone', number: 6, summary: 'Undid a quick edit' };
    return new Response(JSON.stringify({
      editId: 'quick-edit-fixture-1', restored: [ARTIFACT_FILENAME], removed: [], revision: currentRevision,
    }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }
  if (url.endsWith(`/api/v1/artifacts/workspace/${PROJECT_REF}/${ARTIFACT_ID}/quick-edits`)) {
    // A request that needs data goes to the chat, as the router would send it.
    const asked = JSON.parse(String(init?.body || '{}'));
    if (/\bdata\b|sales|warehouse/i.test(asked.message || '')) {
      return new Response(
        `event: route\ndata: ${JSON.stringify({ route: 'agent', confidence: 0.91, ms: 120, reason: 'jev' })}\n\n`
        + `event: done\ndata: ${JSON.stringify({ status: 'agent', summary: '', revisionId: null, previousRevisionId: null, changed: [], check: null, editId: null, undoable: false, ms: 130 })}\n\n`,
        { status: 200, headers: { 'Content-Type': 'text/event-stream' } },
      );
    }
    const previousRevisionId = currentRevision.id;
    currentContent = IS_HTML_SLIDES
      ? currentContent.replace('color: #43d8ef', 'color: #f2b84b')
      : currentContent.replace('# Q3 launch readiness', '# Q3 launch readiness (final)');
    currentRevision = { ...REVISION, id: 'rev-quick', number: 5, summary: 'Quick edit' };
    const frames = [
      ['route', { route: 'edit', confidence: 0.94, ms: 140 }],
      ['progress', { stage: 'reading' }],
      ['progress', { stage: 'writing' }],
      ['done', {
        status: 'applied',
        summary: IS_HTML_SLIDES ? 'Made the kicker amber.' : 'Marked the title as final.',
        revisionId: currentRevision.id,
        previousRevisionId,
        changed: [ARTIFACT_FILENAME],
        check: { status: 'passed', findings: [] },
        editId: 'quick-edit-fixture-1',
        undoable: true,
        ms: 4200,
      }],
    ];
    const encoder = new TextEncoder();
    const body = new ReadableStream({
      async start(controller) {
        for (const [event, data] of frames) {
          await new Promise((resolve) => { setTimeout(resolve, 250); });
          controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
        }
        controller.close();
      },
    });
    return new Response(body, { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
  }
  if (url.endsWith(`/revisions/${PREVIOUS.id}`)) {
    return new Response(JSON.stringify(PREVIOUS), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }
  if (url.includes(`/api/v1/artifacts/workspace/${PROJECT_REF}/${ARTIFACT_ID}/revisions`)) {
    return new Response(JSON.stringify({ revisions: [currentRevision, PREVIOUS] }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }
  if (
    url.includes(`/api/v1/artifacts/workspace/${PROJECT_REF}/${ARTIFACT_ID}`)
    && (init?.method || 'GET').toUpperCase() === 'PUT'
  ) {
    const body = JSON.parse(String(init?.body || '{}'));
    currentContent = body.content;
    currentRevision = {
      ...REVISION,
      id: 'rev-saved',
      number: 5,
      summary: body.summary || 'Edited artifact',
    };
    return new Response(JSON.stringify({
      artifactId: ARTIFACT_ID,
      path: ARTIFACT_FILENAME,
      content: currentContent,
      revision: currentRevision,
    }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }
  if (url.includes(`/api/v1/artifacts/workspace/${PROJECT_REF}/${ARTIFACT_ID}/agent-repairs`)
    && (init?.method || 'GET').toUpperCase() === 'POST'
    && !url.includes('/decision')) {
    repairQueued = true;
    return new Response(JSON.stringify({
      repair: {
        id: 'repair-fixture-1', status: 'queued', commentThreadId: COMMENT.id,
        baseRevisionId: currentRevision.id,
      },
      prompt: 'Address the complete artifact feedback thread.',
    }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }
  if (url.includes('/agent-repairs/repair-fixture-1/decision')) {
    return new Response(JSON.stringify({
      id: 'repair-fixture-1', status: 'accepted', commentThreadId: COMMENT.id,
    }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }
  if (url.includes('/agent-repairs/repair-fixture-1') && repairQueued) {
    currentContent = AGENT_CONTENT;
    currentRevision = {
      ...REVISION,
      id: 'rev-agent',
      number: 5,
      actor: { kind: 'agent', id: 'fixture-agent' },
      summary: 'Agent updated artifact',
    };
    return new Response(JSON.stringify({
      repair: {
        id: 'repair-fixture-1', status: 'ready', commentThreadId: COMMENT.id,
        baseRevisionId: REVISION.id, revisionId: currentRevision.id,
      },
      compare: {
        before: { ...REVISION, content: INITIAL_CONTENT },
        after: { ...currentRevision, content: AGENT_CONTENT },
      },
    }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }
  if (url.includes(`/api/v1/artifacts/workspace/${PROJECT_REF}/${ARTIFACT_ID}`)) {
    return new Response(JSON.stringify({
      artifactId: ARTIFACT_ID,
      path: ARTIFACT_FILENAME,
      content: currentContent,
      contentType: IS_HTML_SLIDES ? 'html' : 'md',
      revision: currentRevision,
      capabilities: {
        role: IS_REVIEWER ? 'reviewer' : 'owner',
        canPreview: true,
        canComment: true,
        canEdit: !IS_REVIEWER,
        canAddressWithAgent: !IS_REVIEWER,
        canResolveComments: !IS_REVIEWER,
        ...OWNER_UNKNOWN_CAPABILITIES,
        ...QUICK_EDIT_CAPABILITIES,
      },
    }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }
  if (url.includes(`/api/v1/artifact-comments/${ARTIFACT_KEY}/threads/${COMMENT.id}/status`)) {
    commentStatus = JSON.parse(String(init?.body || '{}')).status || commentStatus;
    return new Response(JSON.stringify({ ...COMMENT, status: commentStatus, version: 2 }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }
  if (url.includes(`/api/v1/artifact-comments/${ARTIFACT_KEY}/read`)) {
    return new Response(JSON.stringify({ ok: true, unreadCount: 0 }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }
  if (url.includes(`/api/v1/artifact-comments/${ARTIFACT_KEY}/threads`)
    && (init?.method || 'GET').toUpperCase() === 'GET') {
    return new Response(JSON.stringify({
      threads: [{ ...COMMENT, status: commentStatus }],
      viewer: {
        user_id: 'fixture-user',
        email: 'ian@example.com',
        role: IS_REVIEWER ? 'reviewer' : 'owner',
      },
      capabilities: {
        canComment: true,
        canResolve: !IS_REVIEWER,
        canAddressWithAgent: !IS_REVIEWER,
      },
      unreadCount: commentStatus === 'open' ? 1 : 0,
    }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }
  if (url.includes(`/api/v1/artifact-comments/${ARTIFACT_KEY}/stream`)) {
    return new Response('', { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
  }
  return originalFetch(input, init);
};

const theme = SEARCH_PARAMS.get('theme') === 'dark' ? 'dark' : 'light';
document.body.dataset.theme = theme;
document.body.dataset.skin = 'normal';
document.body.classList.add(theme === 'dark' ? 'gf-theme-dark' : 'gf-theme-light');
document.body.style.margin = '0';
document.body.style.background = 'var(--bg)';

const CONVERSATION_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const QUICK_EDIT_CATALOG = 'canQuickEdit' in QUICK_EDIT_CAPABILITIES ? {
  models: [
    { id: 'claude-sonnet-4-5', name: 'Claude Sonnet 4.5' },
    { id: 'gpt-5-mini', name: 'GPT-5 mini' },
  ],
  modelMeta: {
    modelProviders: {},
    modelEfforts: { 'claude-sonnet-4-5': { efforts: ['low', 'medium', 'high'], default: 'high' } },
  },
} : null;

function Fixture() {
  const [artifact, setArtifact] = useState<ArtifactViewerArtifact>({
    id: ARTIFACT_ID,
    slug: IS_HTML_SLIDES ? 'artifact-collaboration-slides' : 'q3-launch-readiness-a1b2c3d4',
    title: IS_HTML_SLIDES ? 'Artifact collaboration deck' : 'Q3 launch readiness',
    description: IS_HTML_SLIDES ? 'An HTML slide deck' : 'A working launch-readiness brief',
    type: IS_HTML_SLIDES ? 'presentation' : 'document',
    ext: IS_HTML_SLIDES ? '.html' : '.md',
    path: `/fixture/${ARTIFACT_FILENAME}`,
    canonicalPath: `/fixture/${ARTIFACT_FILENAME}`,
    primary: ARTIFACT_FILENAME,
    projectId: IS_DESKTOP ? undefined : PROJECT_REF,
    projectName: 'Launch planning',
    mtime: 1724580000,
    modified: false,
    publishedUrl: '',
    accessMode: 'private',
    artifactKey: ARTIFACT_KEY,
    draftUrl: IS_HTML_SLIDES
      ? htmlPreviewUrl(HTML_SLIDES)
      : `/api/v1/artifacts/drafts/${PROJECT_REF}/${ARTIFACT_ID}/${ARTIFACT_FILENAME}`,
    serveUrl: IS_HTML_SLIDES
      ? htmlPreviewUrl(HTML_SLIDES)
      : `/api/v1/artifacts/drafts/${PROJECT_REF}/${ARTIFACT_ID}/${ARTIFACT_FILENAME}`,
  });

  // `?quickEdit=1`: the composer's catalog for the bar's picker, and a chat
  // whose agent answers a message the bar hands it, streamed in words.
  const [chatMessages, setChatMessages] = useState<Array<Record<string, unknown>>>([]);
  const answerInChat = async ({ prompt }: { prompt: string }) => {
    setChatMessages((prev) => [...prev, { role: 'user', content: prompt }]);
    const words = 'I pulled last quarter’s sales from the warehouse and added a **Q3 revenue** column to the deck, by region. North leads at $4.2M.'.split(' ');
    for (let n = 1; n <= words.length; n += 1) {
      await new Promise((resolve) => { setTimeout(resolve, 120); });
      const text = words.slice(0, n).join(' ');
      setChatMessages((prev) => [...prev.filter((m) => m.role !== '_streaming'), { role: '_streaming', content: text, steps: [] }]);
    }
    setChatMessages((prev) => [...prev.filter((m) => m.role !== '_streaming'), { role: 'assistant', content: words.join(' ') }]);
    return true;
  };

  return (
    <ModelPickerContext.Provider value={QUICK_EDIT_CATALOG}>
    <ChatTranscriptContext.Provider value={{ conversationId: CONVERSATION_ID, messages: chatMessages }}>
    <ArtifactViewer
      open
      artifact={artifact}
      onClose={() => undefined}
      onChange={(nextArtifact) => {
        if (!IS_HTML_SLIDES) {
          setArtifact(nextArtifact);
          return;
        }
        const previewUrl = htmlPreviewUrl(currentContent);
        setArtifact({
          ...nextArtifact,
          draftUrl: previewUrl,
          serveUrl: previewUrl,
        });
      }}
      onDelete={() => undefined}
      onAddressWithAgent={'canQuickEdit' in QUICK_EDIT_CAPABILITIES ? answerInChat : async () => undefined}
      conversationId={CONVERSATION_ID}
    />
    </ChatTranscriptContext.Provider>
    </ModelPickerContext.Provider>
  );
}

const rootElement = document.getElementById('root')! as HTMLElement & {
  artifactFixtureRoot?: ReturnType<typeof createRoot>;
};
const fixtureRoot = rootElement.artifactFixtureRoot ?? createRoot(rootElement);
rootElement.artifactFixtureRoot = fixtureRoot;

fixtureRoot.render(
  <StrictMode>
    <ToastProvider>
      <Fixture />
    </ToastProvider>
  </StrictMode>,
);
