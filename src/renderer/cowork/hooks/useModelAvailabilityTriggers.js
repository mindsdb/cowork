import { useEffect, useRef } from 'react';
import { modelAccessSignature } from '../lib/usageWarnings';
import {
  creditsFlowState, endCreditsFlow, followUpDelay, isCreditsFlowArmed, noteCreditsFlowAway,
  noteCreditsFlowReturn, setCreditsFlowPollStart, subscribeCreditsFlow,
} from '../lib/creditsFlow';

// Reasons a top-up can lift; a missing reason is read as one (older sidecars send none).
const CREDIT_REASONS = new Set([undefined, null, 'wallet_empty', 'included_allowance_exhausted']);
// Unarmed focus fallback for builds without hub usage; usage's own focus refresh covers the rest.
export const UNARMED_FOCUS_EVERY_MS = 5 * 60_000;

/** Whether a MindsHub model (`mindsIds`, when known) is locked for lack of credits, not by a rule or budget. */
export function hasCreditLock(modelEnabled, modelDisabledReasons, mindsIds = null) {
  const minds = mindsIds?.length ? new Set(mindsIds) : null;
  return Object.entries(modelEnabled || {}).some(
    ([id, enabled]) => enabled === false && (!minds || minds.has(id)) && CREDIT_REASONS.has(modelDisabledReasons?.[id]),
  );
}

// Focus with a credit lock re-checks (≤1 per 5 min); after a billing link it polls 15s → 30s → 60s for up
// to 10 min while focused. Unarmed checks need a server that honors the narrow 'minds' scope.
export function useModelAvailabilityTriggers({
  refresh, modelEnabled, modelDisabledReasons, mindsIds, usage, canNarrowRefresh = () => true,
}) {
  const creditLocked = hasCreditLock(modelEnabled, modelDisabledReasons, mindsIds);
  const lastUnarmedFocus = useRef(-Infinity);
  const narrowRef = useRef(canNarrowRefresh);
  narrowRef.current = canNarrowRefresh;

  useEffect(() => {
    if (!creditLocked) {
      endCreditsFlow();
      return undefined;
    }
    const check = () => { Promise.resolve(refresh()).catch(() => {}); };
    let timer = null;
    const stop = () => {
      if (timer) clearTimeout(timer);
      timer = null;
    };
    const schedule = () => {
      if (timer || !isCreditsFlowArmed()) return;
      let { pollStart } = creditsFlowState();
      if (pollStart === null) {
        pollStart = Date.now();
        setCreditsFlowPollStart(pollStart);
      }
      const delay = followUpDelay(Date.now() - pollStart);
      if (delay === null) {
        endCreditsFlow();
        return;
      }
      timer = setTimeout(() => {
        timer = null;
        check();
        schedule();
      }, delay);
    };
    const onFocus = () => {
      noteCreditsFlowReturn();
      if (isCreditsFlowArmed()) {
        stop();
        check();
        schedule();
      } else if (narrowRef.current() && Date.now() - lastUnarmedFocus.current >= UNARMED_FOCUS_EVERY_MS) {
        lastUnarmedFocus.current = Date.now();
        check();
      }
    };
    const onBlur = () => {
      noteCreditsFlowAway();
      stop();
    };
    // Armed while Cowork keeps focus (paid on a phone, browser in the background): start now.
    const onFlowChange = () => {
      if (!isCreditsFlowArmed()) stop();
      else if (document.hasFocus()) schedule();
    };
    window.addEventListener('focus', onFocus);
    window.addEventListener('blur', onBlur);
    const unsubscribe = subscribeCreditsFlow(onFlowChange);
    return () => {
      window.removeEventListener('focus', onFocus);
      window.removeEventListener('blur', onBlur);
      unsubscribe();
      stop();
    };
  }, [creditLocked, refresh]);

  // Only a transition between two known reads triggers; the first read and blips don't.
  const prevAccess = useRef(null);
  useEffect(() => {
    const next = modelAccessSignature(usage);
    if (next === null) return;
    if (prevAccess.current !== null && prevAccess.current !== next && narrowRef.current()) {
      Promise.resolve(refresh()).catch(() => {});
    }
    prevAccess.current = next;
  }, [usage, refresh]);
}
