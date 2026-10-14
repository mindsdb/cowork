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
   file, runs a query and then states a figure no step returned. The answers
   here go through the chat's own TextBlock with the event's payload, so the
   marks, tooltips and labels are the ones a user sees. Open with
   `npm run dev:renderer` at /figure-sources-fixture.html, and add ?theme=dark
   for the dark pass. */

/* Offsets come from the answer itself, the way the server computes them: UTF-16
   positions into the markdown source. */
const figure = (text, answer, origin, sources = [], from = 0) => {
  const start = answer.indexOf(text, from);
  return { start, end: start + text.length, text, origin, sources };
};

const file = (toolUseId, label, page = null) => ({ tool_use_id: toolUseId, kind: 'file', label, page });

/* The steps a turn like this one leaves behind. Only `_toolUseId` matters to
   the marks: it is what links a figure's source to the step it opens. */
const STEPS = [
  { id: 'step-1', label: 'Read the stock export', badge: 'Script', status: 'completed', _isScratchpad: true, _scratchpadTabId: 'stock', _toolUseId: 'toolu_01' },
  { id: 'step-2', label: 'Read the supplier price list', badge: 'Script', status: 'completed', _isScratchpad: true, _scratchpadTabId: 'rates', _toolUseId: 'toolu_02' },
  { id: 'step-3', label: 'Query monthly sales', badge: 'Script', status: 'completed', _isScratchpad: true, _scratchpadTabId: 'sales', _toolUseId: 'toolu_03' },
];

const MAIN = "You have **250** units of the blue mug in stock. The supplier's price list puts them at $42 each, which covers the 7 you asked about. Last quarter's price was $30.";

const SEVERAL = 'Sales came to 1,284 units last month, and the export agrees with the query.';

const UNOPENABLE = 'The tracker shows 18 open orders.';

const IN_CODE = 'The query `SELECT 250 FROM stock` returned 250.';

const CASES = [
  {
    id: 'sourced-and-unsourced',
    label: 'One answer with a figure from a file (250), one from a page of a PDF ($42), one from the question (7, unmarked) and one no step returned ($30).',
    text: MAIN,
    figures: [
      figure('250', MAIN, 'step', [file('toolu_01', 'stock.csv')]),
      figure('$42', MAIN, 'step', [file('toolu_02', 'rates.pdf', 1)]),
      figure('7', MAIN, 'question'),
      figure('$30', MAIN, 'none'),
    ],
  },
  {
    id: 'several-sources',
    label: 'A figure two steps returned: the tooltip names the first and counts the rest.',
    text: SEVERAL,
    figures: [
      figure('1,284', SEVERAL, 'step', [
        { tool_use_id: 'toolu_03', kind: 'query', label: 'monthly_sales', page: null },
        file('toolu_01', 'stock.csv'),
      ]),
    ],
  },
  {
    id: 'no-step-to-open',
    label: 'A figure from a tool with no step to open: the tooltip shows, and nothing opens.',
    text: UNOPENABLE,
    figures: [figure('18', UNOPENABLE, 'step', [{ tool_use_id: 'toolu_99', kind: 'web', label: 'https://tracker.example.com/orders', page: null }])],
  },
  {
    id: 'figure-in-code',
    label: 'The same figure inside inline code stays unmarked; the one in prose is marked.',
    text: IN_CODE,
    figures: [
      figure('250', IN_CODE, 'step', [file('toolu_01', 'stock.csv')]),
      figure('250', IN_CODE, 'step', [file('toolu_01', 'stock.csv')], IN_CODE.indexOf('returned')),
    ],
  },
  {
    id: 'no-figure-data',
    label: 'The first answer from a server that sends no figure sources: rendered exactly as before.',
    text: MAIN,
    figures: null,
  },
];

function Case({ id, label, text, figures }) {
  const [opened, setOpened] = useState(null);
  return (
    // Anchored per case, so a screenshot run can crop to one state.
    <section id={`case-${id}`} style={{ marginBottom: 28 }}>
      <p style={{ font: '12px/1.4 var(--font-body, system-ui)', color: 'var(--text-faint)', margin: '0 0 6px' }}>{label}</p>
      <div className="chat-transcript-col" style={{ width: 640, maxWidth: '100%' }}>
        <TextBlock
          text={text}
          id={`fixture-${id}`}
          figureSources={figures}
          steps={STEPS}
          onOpenStep={setOpened}
        />
      </div>
      {opened && (
        <p style={{ font: '12px/1.4 var(--font-mono, monospace)', color: 'var(--text-faint)', margin: '6px 0 0' }}>
          Opened {opened} in the scratchpad.
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
