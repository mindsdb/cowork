import { useEffect, useRef } from 'react';
import './voice-call.css';

/* The voice call on a phone while the browser covers the screen: one small
   orb whose fill rises and falls with Anton's voice (and, fainter, the
   person's). Tapping it shows the call's card again. `call` is
   useVoiceCall's. */

const level = (analyser, buf) => {
  if (!analyser) return 0;
  analyser.getByteFrequencyData(buf);
  let sum = 0;
  for (let i = 0; i < buf.length; i += 1) sum += buf[i];
  return Math.min(1, (sum / buf.length / 255) * 2.6);
};

export default function VoiceOrb({ call, onClick }) {
  const ref = useRef(null);
  useEffect(() => {
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    let frame = 0;
    let smooth = 0;
    const buf = new Uint8Array(128);
    const tick = () => {
      const { agent, user } = call.meters?.current || {};
      const target = Math.max(level(agent, buf), level(user, buf) * 0.5);
      smooth += (target - smooth) * 0.25;
      ref.current?.style.setProperty('--orb-level', reduce ? (target > 0.08 ? '0.6' : '0.15') : smooth.toFixed(3));
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [call]);

  const label = call.phase === 'starting' ? 'Connecting voice' : call.working ? 'Working on it' : 'On a call';
  return (
    <button
      ref={ref}
      type="button"
      className={`voice-orb${call.working ? ' is-working' : ''}${call.phase === 'starting' ? ' is-starting' : ''}`}
      aria-label={`${label}. Show the call`}
      title={label}
      onClick={onClick}
    >
      <span className="voice-orb__fill" aria-hidden="true" />
    </button>
  );
}
