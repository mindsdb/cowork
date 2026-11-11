import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import '../cowork/styles/globals.css';
import '../cowork/styles/skin-8bit.css';
import '../styles.css';
import '../cowork/styles/tailwind.css';
import { Alert, Button } from '../cowork/components/ui';
import ScheduleRunAlert from '../cowork/components/schedule/ScheduleRunAlert';

/* Alert as the app uses it, on one page: each variant, with and without a
   title, with actions, and the schedule run alerts built from the real
   `runAlert` copy. Most of these need a broken connection, an old shell or a
   failing run to reach in the app. Open with `npm run dev:renderer` at
   /alert-fixture.html, and add ?theme=dark for the dark pass. */

const schedule = (over = {}) => ({ id: 's1', title: 'Weekly Linear digest', cadence: 'weekly', enabled: true, ...over });

const CASES = [
  {
    label: 'Schedule auto-paused (task page)',
    node: <ScheduleRunAlert task={schedule({ enabled: false, autoPausedAt: '2026-10-08T14:00:00Z', consecutiveFailures: 3, lastRun: { status: 'failed', error: 'The Linear connection needs to be reconnected.', conversationId: 'c1' } })} />,
  },
  {
    label: 'Schedule run stopped partway',
    node: <ScheduleRunAlert task={schedule({ lastRunStatus: 'failed', lastRun: { status: 'failed', outcome: 'interrupted', error: 'The app quit during the run.', conversationId: 'c1' } })} />,
  },
  {
    label: 'Schedule paused while a run finishes',
    node: <ScheduleRunAlert task={schedule({ enabled: false, running: true })} />,
  },
  {
    label: 'Scheduled list: auto-pauses to review',
    node: (
      <Alert variant="danger" title="“Weekly Linear digest” was paused after failing several runs in a row" actions={<Button size="sm">Review</Button>} />
    ),
  },
  {
    label: 'Form error (most uses: no title)',
    node: <Alert variant="danger">Could not save schedule.</Alert>,
  },
  {
    label: 'Load error with a retry (Code Mode tasks)',
    node: <Alert variant="danger" actions={<Button variant="subtle" size="sm">Try again</Button>}>Couldn’t load tasks. Check your connection and try again.</Alert>,
  },
  {
    label: 'Connect Apps: reconnection required',
    node: <Alert variant="warning" title="Reconnection required">Access for this connection has expired or was revoked. Reconnect to restore access, or remove the connection.</Alert>,
  },
  {
    label: 'Settings › Updates: shell too old',
    node: <Alert variant="warning">This app is too old for this version of Cowork. Some features are hidden until the app updates to 2.1.0. Use Software updates below.</Alert>,
  },
  {
    label: 'Code Mode review: applied',
    node: <Alert variant="success">These reviewed changes were applied to the source folders.</Alert>,
  },
  {
    label: 'Connector picker: info',
    node: <Alert variant="info">Pick the files Anton may read. You can change this later from the connection.</Alert>,
  },
];

/* The app themes off body[data-theme]; see usage-bar.jsx for why the fixture
   paints the ground and lets the page scroll. */
document.body.dataset.theme = new URLSearchParams(window.location.search).get('theme') === 'dark' ? 'dark' : 'light';
document.body.style.background = 'var(--bg)';
document.documentElement.style.overflow = 'auto';
document.body.style.overflow = 'auto';
document.body.style.height = 'auto';

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <main style={{ padding: 32, display: 'flex', flexDirection: 'column', gap: 18, maxWidth: 760 }}>
      {CASES.map((c) => (
        <section key={c.label}>
          <p style={{ font: '12px/1.4 var(--font-body, system-ui)', color: 'var(--text-faint)', margin: '0 0 6px' }}>{c.label}</p>
          {c.node}
        </section>
      ))}
    </main>
  </StrictMode>,
);
