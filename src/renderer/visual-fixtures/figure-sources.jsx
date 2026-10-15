import { StrictMode, useState } from 'react';
import { createRoot } from 'react-dom/client';

import '../cowork/styles/globals.css';
import '../cowork/styles/skin-8bit.css';
import '../styles.css';
import '../cowork/styles/tailwind.css';
import { TextBlock } from '../cowork/views/ChatView';

/* Every way a figure in a finished answer can be marked, on one page.

   cowork-server sends `response.figure_sources` at the end of a turn whose
   answer holds a number, so seeing a mark for real takes a turn that reads a
   file, runs a query, reads a web page and then states a figure no step
   returned. The answers here go through the chat's own TextBlock with the
   event's payload, so the marks, tooltips, popovers and labels are the ones a
   user sees. Click a mark for its popover. Open with `npm run dev:renderer` at
   /figure-sources-fixture.html, and add ?theme=dark for the dark pass. The
   answers ran in project `acme` (proj-1), which is the chat's project here,
   except in the case where the chat moved to another project.
   e2e/figure-sources.spec.ts checks the popover stays on screen at phone
   sizes on this page. */

/* Offsets come from the answer itself, the way the server computes them: UTF-16
   positions into the markdown source. */
const figure = (text, answer, origin, sources = [], from = 0) => {
  const start = answer.indexOf(text, from);
  return { start, end: start + text.length, text, origin, sources };
};
const from = (toolUseId, page = null) => ({ tool_use_id: toolUseId, page });

/* The event's steps: one per source a figure below names. */
const step = (toolUseId, kind, label, extra = {}) => ({
  tool_use_id: toolUseId, kind, label, path: null, attachment_id: null, url: null, queries: [], requests: [], ...extra,
});
const EVENT_STEPS = [
  step('toolu_01', 'file', 'stock.csv', { path: 'data/stock.csv' }),
  step('toolu_02', 'query', 'Query stock for site S1', {
    queries: ["SELECT site, sku, qty\nFROM stock\nWHERE site = 'S1'\n  AND sku = {sku}\nORDER BY qty DESC"],
  }),
  step('toolu_03', 'file', 'rates.pdf', { path: 'docs/rates.pdf' }),
  step('toolu_04', 'web', 'example.com/rates', { url: 'https://example.com/rates' }),
  step('toolu_05', 'query', 'Read inventory from the ERP API', {
    requests: ['GET {DS_ERP_URL}/inventory?site=S1&sku=blue-mug&fields=sku,qty,reserved,on_order&as_of={today}'],
  }),
  step('toolu_06', 'memory', 'memory'),
  step('toolu_07', 'file', 'counts.csv', { attachment_id: 'file-123' }),
  step('toolu_08', 'file', 'q3-2026-inventory-snapshot-by-site-and-part-exported-from-the-planning-system.csv', {
    path: 'exports/q3-2026-inventory-snapshot-by-site-and-part-exported-from-the-planning-system.csv',
  }),
];

/* The chat every case renders in. View file reads an attached file through
   the chat's project and conversation, so both are set. */
const CHAT = { conversationId: 'conv-1', projectId: 'proj-1', projectName: 'acme' };

/* The steps a turn like this one leaves behind. Only `_toolUseId` matters to
   the marks: it is what links a figure's source to the step it opens. */
const STEPS = [
  { id: 'step-1', label: 'Read the stock export', badge: 'Script', status: 'completed', _isScratchpad: true, _scratchpadTabId: 'stock', _toolUseId: 'toolu_01' },
  { id: 'step-2', label: 'Query stock for site S1', badge: 'Script', status: 'completed', _isScratchpad: true, _scratchpadTabId: 'sales', _toolUseId: 'toolu_02' },
  { id: 'step-3', label: 'Read the supplier price list', badge: 'Script', status: 'completed', _isScratchpad: true, _scratchpadTabId: 'rates', _toolUseId: 'toolu_03' },
];

const MAIN = "You have **250** units of the blue mug in stock. The supplier's price list puts them at $42 each, which covers the 7 you asked about. Last quarter's price was $30.";

const SEVERAL = 'Sales came to 1,284 units last month, and the ERP agrees with the published rates.';

const REMEMBERED = 'You asked to keep at least 40 units on hand.';

const IN_CODE = 'The query `SELECT 250 FROM stock` returned 250.';

const ATTACHED = 'The counts you attached show 118 units.';

const LONG_NAME = 'The quarter-end snapshot shows 96 units at S3.';

const TABLE = [
  '| Site | Units | Price |',
  '| --- | --- | --- |',
  '| S1 | 250 | $42 |',
  '| S2 | 118 | $30 |',
].join('\n');

const sources = (figures, projectId = 'proj-1') => ({ project_id: projectId, steps: EVENT_STEPS, figures });

const CASES = [
  {
    id: 'sourced-and-unsourced',
    label: 'A figure from a file and a SQL query (250, dotted line), one from a page of a PDF ($42), one from the question (7, unmarked) and one no step returned ($30, solid amber line).',
    text: MAIN,
    figureSources: sources([
      figure('250', MAIN, 'step', [from('toolu_01'), from('toolu_02')]),
      figure('$42', MAIN, 'step', [from('toolu_03', 1)]),
      figure('7', MAIN, 'question'),
      figure('$30', MAIN, 'none'),
    ]),
  },
  {
    id: 'several-sources',
    label: 'A figure from an API request and a web page, neither a step of this turn can open: the popover lists both, with the request (wrapped) and the link.',
    text: SEVERAL,
    figureSources: sources([figure('1,284', SEVERAL, 'step', [from('toolu_05'), from('toolu_04')])]),
  },
  {
    id: 'from-memory',
    label: 'A figure from memory.',
    text: REMEMBERED,
    figureSources: sources([figure('40', REMEMBERED, 'step', [from('toolu_06')])]),
  },
  {
    id: 'figure-in-code',
    label: 'The same figure inside inline code stays unmarked; the one in prose is marked.',
    text: IN_CODE,
    figureSources: sources([
      figure('250', IN_CODE, 'step', [from('toolu_01')]),
      figure('250', IN_CODE, 'step', [from('toolu_01')], IN_CODE.indexOf('returned')),
    ]),
  },
  {
    id: 'attached-file',
    label: 'A figure from a file attached to the chat: View file opens it by its id, whatever project the chat is in.',
    text: ATTACHED,
    figureSources: sources([figure('118', ATTACHED, 'step', [from('toolu_07')])]),
  },
  {
    id: 'long-file-name',
    label: 'A figure from a file with a long name: the popover grows to its widest and the name ends in an ellipsis, whole on hover.',
    text: LONG_NAME,
    figureSources: sources([figure('96', LONG_NAME, 'step', [from('toolu_08')])]),
  },
  {
    id: 'moved-project',
    label: 'The first answer after the chat moved to another project: the project file offers no View file, since the same name there is another file.',
    text: MAIN,
    figureSources: sources([figure('250', MAIN, 'step', [from('toolu_01')])], 'proj-0'),
  },
  {
    id: 'table',
    label: 'Figures in a table share one tab stop: Tab reaches the first, the arrow keys move between them.',
    text: TABLE,
    figureSources: sources([
      figure('250', TABLE, 'step', [from('toolu_01')]),
      figure('$42', TABLE, 'step', [from('toolu_03', 1)]),
      figure('118', TABLE, 'step', [from('toolu_07')]),
      figure('$30', TABLE, 'none'),
    ]),
  },
  {
    id: 'setting-off',
    label: 'Settings > Appearance > "Show where figures came from" turned off: the first answer, unmarked.',
    text: MAIN,
    figureSources: sources([figure('250', MAIN, 'step', [from('toolu_01')]), figure('$30', MAIN, 'none')]),
    showFigureSources: false,
  },
  {
    id: 'no-figure-data',
    label: 'The first answer from a server that sends no figure sources: rendered exactly as before.',
    text: MAIN,
    figureSources: null,
  },
];

function Case({ id, label, text, figureSources, showFigureSources = true }) {
  const [opened, setOpened] = useState(null);
  return (
    // Anchored per case, so a screenshot run can crop to one state.
    <section id={`case-${id}`} style={{ marginBottom: 28 }}>
      <p style={{ font: '12px/1.4 var(--font-body, system-ui)', color: 'var(--text-faint)', margin: '0 0 6px' }}>{label}</p>
      <div className="chat-transcript-col" style={{ width: 640, maxWidth: '100%' }}>
        <TextBlock
          text={text}
          id={`fixture-${id}`}
          figureSources={figureSources}
          steps={STEPS}
          onOpenStep={(stepId) => setOpened(`Opened ${stepId} in the scratchpad.`)}
          onViewFile={(source) => setOpened(source.path
            ? `Opened ${source.path} from the project in the file viewer.`
            : `Opened attachment ${source.attachment_id} (${source.label}) in the file viewer.`)}
          showFigureSources={showFigureSources}
          {...CHAT}
        />
      </div>
      {opened && (
        <p style={{ font: '12px/1.4 var(--font-mono, monospace)', color: 'var(--text-faint)', margin: '6px 0 0' }}>
          {opened}
        </p>
      )}
    </section>
  );
}

/* The app themes off body[data-theme], so honour the same switch and paint the
   themed ground behind it. globals.css pins html/body to overflow:hidden for
   the app shell, so the fixture scrolls instead. */
document.body.dataset.theme = new URLSearchParams(window.location.search).get('theme') === 'dark' ? 'dark' : 'light';
document.body.style.background = 'var(--bg)';
document.documentElement.style.overflow = 'auto';
document.body.style.overflow = 'auto';
document.body.style.height = 'auto';

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <main style={{ padding: 32, display: 'flex', flexDirection: 'column' }}>
      {CASES.map((c) => <Case key={c.id} {...c} />)}
    </main>
  </StrictMode>,
);
