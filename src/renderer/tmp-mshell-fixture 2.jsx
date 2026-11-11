import { createRoot } from 'react-dom/client';
import './cowork/styles/globals.css';
import './cowork/styles/skin-8bit.css';
import './styles.css';
import './cowork/styles/tailwind.css';
import MobileShell from './cowork/components/MobileShell';
const q = new URLSearchParams(location.search);
document.body.dataset.theme = q.get('theme') === 'light' ? 'light' : 'dark';
const tasks = ['hi', 'Research what has happened involving the Fed', 'Investigate whether U.S. authorities knew', 'Research NVIDIA (NVDA) stock performance', 'Plan the Q3 offsite', 'Draft the board memo'].map((title, i) => ({ id: `t${i}`, title, projectName: 'general' }));
createRoot(document.getElementById('root')).render(
  <MobileShell route="task" currentTask={tasks[0]} tasks={tasks} projects={[{ name: 'general' }]} scheduled={[]} artifacts={[]}
    onShowBrowser={() => {}} callShortcut={{ label: 'Call Anton', onClick: () => {} }} theme={document.body.dataset.theme}>
    <div style={{ padding: 20, color: 'var(--ink)' }}>Home</div>
  </MobileShell>,
);
