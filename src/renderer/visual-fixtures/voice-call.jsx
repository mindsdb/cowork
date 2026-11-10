import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import '../cowork/styles/globals.css';
import '../cowork/styles/skin-8bit.css';
import '../styles.css';
import '../cowork/styles/tailwind.css';
import VoiceCallWindow from '../cowork/components/VoiceCallWindow';

/* The voice call's card in each state, docked in a sidebar-wide column, with
   made-up voices driving the sound waves: a real call needs a microphone and
   a GPT-Live session. Open with `npm run dev:renderer` at
   /voice-call-fixture.html; add ?theme=dark, and ?skin=8bit. */

// An AnalyserNode stand-in: a speech-like spectrum that rises and falls in
// syllables. `quiet` voices stay near silence.
function fakeVoice({ seed = 1, loud = 1 } = {}) {
  return {
    getByteFrequencyData(out) {
      const t = performance.now() / 1000;
      const syllable = 0.55 + 0.45 * Math.sin(t * 5.3 + seed) * Math.sin(t * 1.7 + seed * 2);
      for (let i = 0; i < out.length; i += 1) {
        const formant = Math.exp(-(((i - 8 - 3 * Math.sin(t + seed)) / 6) ** 2)) + 0.6 * Math.exp(-(((i - 26) / 9) ** 2));
        out[i] = Math.min(255, 255 * loud * syllable * formant * (0.85 + 0.15 * Math.sin(i * 1.3 + t * 9)));
      }
    },
  };
}

const base = {
  notice: '', captions: { user: '', agent: '', last: null }, agentSpeaking: false,
  working: false, micOn: true, start() {}, end() {}, toggleMic() {}, dismiss() {},
};
const CASES = [
  { label: 'Anton talking', call: { ...base, phase: 'live', meters: { current: { agent: fakeVoice({ seed: 1 }), user: null } } } },
  { label: 'The person talking', call: { ...base, phase: 'live', meters: { current: { agent: null, user: fakeVoice({ seed: 4, loud: 0.9 }) } } } },
  { label: 'Anton working on it', call: { ...base, phase: 'live', working: true, meters: { current: { agent: null, user: null } } } },
  { label: 'Muted', call: { ...base, phase: 'live', micOn: false, meters: { current: { agent: null, user: null } } } },
  { label: 'Connecting', call: { ...base, phase: 'starting', meters: { current: { agent: null, user: null } } } },
  { label: 'Ended from the other side', call: { ...base, phase: 'ended', notice: 'The call ended (timeout).' } },
];

const params = new URLSearchParams(window.location.search);
document.body.dataset.theme = params.get('theme') === 'dark' ? 'dark' : 'light';
if (params.get('skin') === '8bit') document.body.dataset.skin = '8bit';
document.body.style.background = 'var(--bg)';
document.documentElement.style.overflow = 'auto';
document.body.style.overflow = 'auto';
document.body.style.height = 'auto';

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <main style={{ padding: 24, display: 'grid', gridTemplateColumns: 'repeat(3, 280px)', gap: 18 }}>
      {CASES.map((c) => (
        <section key={c.label} style={{ background: 'var(--sidebar-bg, var(--surface))', border: '1px solid var(--line)', borderRadius: 14, padding: '10px 0 2px' }}>
          <p style={{ font: '11px/1.4 var(--font-body, system-ui)', color: 'var(--ink-4)', margin: '0 12px 8px' }}>{c.label}</p>
          <VoiceCallWindow call={c.call} docked />
        </section>
      ))}
    </main>
  </StrictMode>,
);
