import { useEffect } from 'react';
import Ico from './Icons';

// The video call's square (prototype): Anton's avatar, the person's own
// camera in a corner, live captions of both sides, and the call's controls.
// It floats over the app, so it stays while the person moves between the
// task and the rest of the app. `call` is useFacetimeCall's.

const STATUS = {
  starting: 'Calling Anton…',
  preparing: 'Anton is getting ready. This can take up to half a minute.',
};

function clock(seconds) {
  const s = Math.max(0, Math.floor(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

function RoundButton({ label, onClick, danger = false, children }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className={`w-10 h-10 rounded-full inline-flex items-center justify-center border-0 cursor-pointer text-white ${
        danger ? 'bg-[#d93025] hover:bg-[#b3261e]' : 'bg-white/20 hover:bg-white/30'
      }`}
    >
      {children}
    </button>
  );
}

export default function FacetimeWindow({ call, agentLabel = 'Anton' }) {
  const { phase, notice, captions, speaking, working, micOn, cameraOn, secondsLeft } = call;

  // The refs exist only while this is on screen: attach what already arrived.
  useEffect(() => { call.attach(); }, [phase, cameraOn]); // eslint-disable-line react-hooks/exhaustive-deps

  if (phase === 'idle') return null;
  const live = phase === 'live';

  return (
    <div
      role="dialog"
      aria-label={`Video call with ${agentLabel}`}
      className="fixed right-4 bottom-4 z-[60] w-[320px] h-[320px] max-w-[calc(100vw-32px)] rounded-2xl overflow-hidden bg-[#111] shadow-2xl text-white"
    >
      <video
        ref={call.avatarVideoRef}
        autoPlay
        playsInline
        className={`absolute inset-0 w-full h-full object-cover transition-opacity ${live ? 'opacity-100' : 'opacity-0'}`}
      />
      <audio ref={call.avatarAudioRef} autoPlay />

      <span className="absolute top-2 left-2 text-[11px] font-semibold px-1.5 py-0.5 rounded bg-black/50">AI</span>
      {secondsLeft != null && live && (
        <span className="absolute top-2 left-10 text-[11px] px-1.5 py-0.5 rounded bg-black/50">{clock(secondsLeft)}</span>
      )}

      {cameraOn && phase !== 'ended' && (
        <video
          ref={call.selfVideoRef}
          autoPlay
          playsInline
          muted
          aria-label="Your camera"
          className={`absolute top-2 right-2 w-[84px] h-[84px] rounded-lg object-cover -scale-x-100 border-2 ${
            speaking.user ? 'border-[#53AECA]' : 'border-white/30'
          }`}
        />
      )}

      {!live && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 p-6 text-center">
          <div className="text-sm text-white/80">{phase === 'ended' ? (notice || 'The call ended.') : STATUS[phase]}</div>
          {phase === 'ended' && (
            <button
              type="button"
              onClick={call.dismiss}
              className="text-sm px-3 py-1.5 rounded-lg bg-white/20 hover:bg-white/30 border-0 text-white cursor-pointer"
            >
              Close
            </button>
          )}
        </div>
      )}

      {live && working && (
        <div className="absolute top-2 left-1/2 -translate-x-1/2 text-[12px] px-2 py-0.5 rounded-full bg-black/60" aria-live="polite">
          {agentLabel} is working on it…
        </div>
      )}

      {live && (captions.avatar || captions.user) && (
        <div className="absolute left-0 right-0 bottom-[60px] px-3 flex flex-col gap-1 text-[12.5px] leading-snug" aria-live="polite">
          {captions.user && (
            <div className={`self-end max-w-[90%] px-2 py-1 rounded-lg bg-black/55 text-white/85 ${captions.last === 'user' ? '' : 'opacity-70'}`}>
              {captions.user}
            </div>
          )}
          {captions.avatar && (
            <div className={`self-start max-w-[90%] px-2 py-1 rounded-lg bg-black/65 ${captions.last === 'avatar' ? '' : 'opacity-70'}`}>
              {captions.avatar}
            </div>
          )}
        </div>
      )}

      {phase !== 'ended' && (
        <div className="absolute left-0 right-0 bottom-0 h-[56px] flex items-center justify-center gap-3 bg-gradient-to-t from-black/70 to-transparent">
          <RoundButton label={micOn ? 'Mute' : 'Unmute'} onClick={call.toggleMic}>
            {micOn ? Ico.mic(16) : Ico.micOff(16)}
          </RoundButton>
          <RoundButton label={cameraOn ? 'Turn camera off' : 'Turn camera on'} onClick={call.toggleCamera}>
            {cameraOn ? Ico.video(16) : Ico.videoOff(16)}
          </RoundButton>
          <RoundButton label="Hang up" onClick={call.end} danger>
            {Ico.hangUp(16)}
          </RoundButton>
        </div>
      )}
    </div>
  );
}
