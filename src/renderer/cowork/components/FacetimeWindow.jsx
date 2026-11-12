import { useEffect, useRef, useState } from 'react';
import Ico from './Icons';
import { useBreakpoint } from '../hooks/useBreakpoint';
import { useTranslation } from '../../lib/i18n';
import './video-call.css';

// The video call's window (prototype): Anton's avatar, the person's own
// camera in a corner, live captions of both sides, and the call's controls.
// It floats over the app, so it stays while the person moves between the
// task and the rest of the app, and never covers the composer
// (video-call.css). It minimizes to an avatar bubble, and on a wide desktop
// it can be dragged; the spot is kept on this device. `call` is
// useFacetimeCall's.

// The status line's key for each phase before the call is live.
const STATUS = {
  starting: 'videoCall.starting',
  preparing: 'videoCall.preparing',
};

const SPOT_KEY = 'cowork.videoCallSpot';
// Keeps at least this much of a dragged window on screen.
const KEEP_VISIBLE = 96;

function clock(seconds) {
  const s = Math.max(0, Math.floor(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

function readSpot() {
  try {
    const spot = JSON.parse(localStorage.getItem(SPOT_KEY) || 'null');
    return spot && Number.isFinite(spot.left) && Number.isFinite(spot.top) ? spot : null;
  } catch {
    return null;
  }
}

function saveSpot(spot) {
  try {
    localStorage.setItem(SPOT_KEY, JSON.stringify(spot));
  } catch {
    // Kept for this window only.
  }
}

function onScreen({ left, top }) {
  return {
    left: Math.min(Math.max(left, KEEP_VISIBLE - 320), window.innerWidth - KEEP_VISIBLE),
    top: Math.min(Math.max(top, 0), window.innerHeight - KEEP_VISIBLE),
  };
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
  const { t } = useTranslation('chat');
  const { phase, notice, captions, speaking, working, micOn, cameraOn, secondsLeft } = call;
  const { isNarrow } = useBreakpoint();
  const [minimized, setMinimized] = useState(false);
  const [spot, setSpot] = useState(readSpot);
  const [dragging, setDragging] = useState(false);
  const drag = useRef(null);

  // The refs exist only while this is on screen: attach what already arrived.
  useEffect(() => { call.attach(); }, [phase, cameraOn]); // eslint-disable-line react-hooks/exhaustive-deps
  // Each call opens full size.
  useEffect(() => { if (phase === 'idle') setMinimized(false); }, [phase]);

  if (phase === 'idle') return null;
  const live = phase === 'live';
  const isMin = minimized && phase !== 'ended';
  const draggable = !isNarrow && !isMin;

  const onPointerDown = (event) => {
    if (!draggable || event.button !== 0 || event.target.closest('button')) return;
    const box = event.currentTarget.getBoundingClientRect();
    drag.current = { dx: event.clientX - box.left, dy: event.clientY - box.top, moved: false };
    event.currentTarget.setPointerCapture?.(event.pointerId);
  };
  const onPointerMove = (event) => {
    if (!drag.current) return;
    drag.current.moved = true;
    setDragging(true);
    setSpot(onScreen({ left: event.clientX - drag.current.dx, top: event.clientY - drag.current.dy }));
  };
  const onPointerUp = () => {
    if (drag.current?.moved && spot) saveSpot(spot);
    drag.current = null;
    setDragging(false);
  };

  const placed = draggable && spot ? { ...onScreen(spot), right: 'auto' } : undefined;
  const classes = [
    'video-call',
    isMin && 'is-min',
    isMin && speaking.avatar && 'is-talking',
    draggable && 'is-draggable',
    dragging && 'is-dragging',
  ].filter(Boolean).join(' ');

  return (
    <div
      role="dialog"
      aria-label={t('videoCall.dialogLabel', { agent: agentLabel })}
      className={classes}
      style={placed}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
    >
      <video
        ref={call.avatarVideoRef}
        autoPlay
        playsInline
        className="video-call__avatar"
        style={{ opacity: live ? 1 : 0 }}
      />
      <audio ref={call.avatarAudioRef} autoPlay />

      {isMin && (
        <button
          type="button"
          aria-label={t('videoCall.show', { agent: agentLabel })}
          title={t('videoCall.show', { agent: agentLabel })}
          onClick={() => setMinimized(false)}
          className="absolute inset-0 w-full h-full border-0 bg-transparent cursor-pointer"
        />
      )}

      <div className="video-call__chrome">
        <span className="absolute top-2 left-2 text-[11px] font-semibold px-1.5 py-0.5 rounded bg-black/50">{t('videoCall.aiBadge')}</span>
        {secondsLeft != null && live && (
          <span className="absolute top-2 left-10 text-[11px] px-1.5 py-0.5 rounded bg-black/50">{clock(secondsLeft)}</span>
        )}

        {/* The X in a circle on the corner ends the call; shown on hover. */}
        {phase !== 'ended' && (
          <button type="button" className="video-call__x" onClick={call.end} aria-label={t('videoCall.endCall')} title={t('videoCall.endCall')}>
            {Ico.close(12)}
          </button>
        )}

        {cameraOn && phase !== 'ended' && (
          <video
            ref={call.selfVideoRef}
            autoPlay
            playsInline
            muted
            aria-label={t('videoCall.yourCamera')}
            className={`video-call__self${speaking.user ? ' is-speaking' : ''}`}
          />
        )}

        {!live && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 p-6 text-center">
            <div className="text-sm text-white/80">{phase === 'ended' ? (notice || t('videoCall.ended')) : STATUS[phase] && t(STATUS[phase])}</div>
            {phase === 'ended' && (
              <button
                type="button"
                onClick={call.dismiss}
                className="text-sm px-3 py-1.5 rounded-lg bg-white/20 hover:bg-white/30 border-0 text-white cursor-pointer"
              >
                {t('videoCall.close')}
              </button>
            )}
          </div>
        )}

        {live && working && (
          <div className="absolute top-2 left-1/2 -translate-x-1/2 text-[12px] px-2 py-0.5 rounded-full bg-black/60 whitespace-nowrap" aria-live="polite">
            {t('videoCall.working', { agent: agentLabel })}
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
            <RoundButton label={micOn ? t('videoCall.mute') : t('videoCall.unmute')} onClick={call.toggleMic}>
              {micOn ? Ico.mic(16) : Ico.micOff(16)}
            </RoundButton>
            <RoundButton label={cameraOn ? t('videoCall.cameraOff') : t('videoCall.cameraOn')} onClick={call.toggleCamera}>
              {cameraOn ? Ico.video(16) : Ico.videoOff(16)}
            </RoundButton>
            <RoundButton label={t('videoCall.minimize')} onClick={() => setMinimized(true)}>
              {Ico.minimize(16)}
            </RoundButton>
          </div>
        )}
      </div>
    </div>
  );
}
