import { StrictMode, useState } from 'react';
import { createRoot } from 'react-dom/client';

import '../cowork/styles/globals.css';
import '../cowork/styles/skin-8bit.css';
import '../styles.css';
import '../cowork/styles/tailwind.css';
import { ArtifactViewer } from '../cowork/components/artifact';
import type { ArtifactViewerArtifact } from '../cowork/components/artifact';
import { ToastProvider } from '../cowork/components/ui/Toast';

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
const IS_REVIEWER = SEARCH_PARAMS.get('role') === 'reviewer';
const IS_DESKTOP = SEARCH_PARAMS.get('deployment') === 'desktop';
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
    return new Response(JSON.stringify({ publishedUrl: '', accessMode: 'private', artifactKey: ARTIFACT_KEY }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }
  if (url.includes(`/api/v1/artifacts/workspace/${PROJECT_REF}/${ARTIFACT_ID}/comments-access`)) {
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
      },
      currentRevision,
    }), { status: 200, headers: { 'Content-Type': 'application/json' } });
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

  return (
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
      onAddressWithAgent={async () => undefined}
      conversationId="bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"
    />
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
