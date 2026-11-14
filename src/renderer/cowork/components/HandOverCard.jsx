import { useEffect, useMemo, useRef, useState } from 'react';
import { submitAnswer } from '../api';
import { dropHandBack, handBackBrowser, handedBack } from '../lib/browserHandBack';
import { useBrowserHandOver } from '../lib/browserHandOverContext';
import { parseHandOverPrompt } from '../lib/browserHandOverPrompt';
import { BrowserSitePill } from './BrowserStepPills';
import ChatCardShell from './ChatCardShell';
import { MarkdownPlainText } from './markdown/MarkdownContent';
import { diagnostic } from '../../../shared/diagnostics';
import { useTranslation } from '../../lib/i18n';

/**
 * A browser hand-over's card (lib/browserHandOverPrompt.js): the person's turn
 * in the browser, for one thing anton names. Done, continue does exactly what
 * the browser's own Done does (lib/browserHandBack.js), so it never answers
 * the card: anton retires it once the browser is back, whichever way it came
 * back, and the card then folds into the turn's steps. Open browser shows the
 * pane when it is hidden. Finish later and Stop answer the card.
 *
 * `ended`: the card's turn ended with the browser still the person's (left
 * for later, timed out, or no longer live). Done, continue then also carries
 * the task on, as the browser's Done does after such a turn, and only once
 * the browser is back: on the web with the pane closed, the hand-back waits
 * for the viewer, and a turn that started first would meet the browser
 * still the person's. A viewer that can't open ends that wait: the card says
 * so and takes Done, continue again, and carries nothing on, since the
 * browser may still be theirs. The card ends that wait itself when it goes,
 * or when its hand-over ends or changes, so a viewer that comes later never
 * runs this Done for a later hand-over.
 *
 * Stop also tells the chat (`stopTask`), so a hand-back after it carries
 * nothing on: the person stopped the task.
 */
export default function HandOverCard({ step, conversationId, onAnswered, ended = false }) {
  const { t } = useTranslation('chat');
  const q = step?.data || {};
  const parsed = useMemo(() => parseHandOverPrompt(q.prompt), [q.prompt]);
  const { sessionId, paneShown, openBrowser, continueTask, stopTask, agentLabel } = useBrowserHandOver();
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState('');
  /* The Done, continue this card is working on, until its hand-back went or
     ended: a token the click checks after each wait, so a click that outlived
     its card or its hand-over does nothing more. */
  const waitRef = useRef(null);
  useEffect(() => {
    // A new hand-over, or one that ended, takes clicks again.
    setBusy(false);
    setProblem('');
    /* A hand-back this card still waits on ends with it (the card goes, or
       its hand-over ends or changes), so a later hand-over never gets this
       Done. */
    return () => {
      if (!waitRef.current) return;
      waitRef.current = null;
      dropHandBack(sessionId);
    };
  }, [q.question_id, ended, sessionId]);

  if (!parsed) return null;
  const agent = agentLabel || 'Anton';

  const handBack = async () => {
    if (busy) return;
    setBusy(true);
    setProblem('');
    const wait = {};
    waitRef.current = wait;
    let sent;
    try {
      sent = await handBackBrowser(sessionId);
    } catch (error) {
      diagnostic('renderer.cowork.hand-over-card', 'WARNING', 'browser_hand_back_failed', error);
      sent = 'none';
    }
    if (waitRef.current !== wait) return;
    if (sent === 'none') {
      waitRef.current = null;
      setProblem(t('askUser.handOver.noBrowser'));
      setBusy(false);
      return;
    }
    if (sent === 'waiting') {
      /* The web viewer isn't framed yet: the pane opens, and Done goes once it
         is. Heard before the pane opens, since a pane that can't open ends
         the wait at once. Busy meanwhile; Open browser still shows a pane
         closed again. */
      const back = handedBack(sessionId);
      openBrowser();
      const end = await back;
      if (waitRef.current !== wait) return;
      if (end === 'unreachable') {
        waitRef.current = null;
        setProblem(t('askUser.handOver.notOpened'));
        setBusy(false);
        return;
      }
    }
    waitRef.current = null;
    // Live, the card stays busy until anton retires it.
    if (!ended) return;
    continueTask?.();
    setBusy(false);
  };

  const answer = async (value) => {
    if (busy) return;
    setBusy(true);
    const result = await submitAnswer(conversationId, q.question_id, { values: [value] });
    if (result?.status === 'error' || result?.status === 'rejected') setBusy(false);
    else if (value === 'stop') stopTask?.();
    onAnswered?.(result, conversationId, q.question_id);
  };

  const line = ended
    ? t('askUser.handOver.stillYours', { agent })
    : parsed.watching
      ? t('askUser.handOver.watching', { agent })
      : t('askUser.handOver.manual', { agent });

  return (
    <ChatCardShell
      tone="question"
      kind={false}
      data-testid="hand-over-card"
      actions={{
        primary: { label: t('askUser.handOver.doneContinue'), onClick: () => { void handBack(); }, disabled: busy },
        secondary: paneShown ? null : { label: t('askUser.handOver.openBrowser'), onClick: openBrowser },
        overflow: ended ? [] : [
          { label: t('askUser.handOver.finishLater'), onClick: () => { void answer('later'); }, disabled: busy },
          { label: t('askUser.handOver.stop'), onClick: () => { void answer('stop'); }, disabled: busy },
        ],
      }}
    >
      <div className="flex flex-col gap-1.5 text-ink">
        <div className="flex min-w-0 flex-wrap items-center gap-1.5">
          <strong className="font-semibold text-ink">{t('askUser.handOver.title')}</strong>
          {/* Whole, on as many lines as it needs: a phone can't hover for it. */}
          {parsed.site ? <BrowserSitePill site={parsed.site} size="sm" wrap /> : null}
        </div>
        {/* anton's reason, as the browser's own banner shows it: text, never markdown. */}
        <MarkdownPlainText>{parsed.reason}</MarkdownPlainText>
        <span className="text-xs text-ink-3">{line}</span>
      </div>
      {problem ? <div role="alert" className="mt-2 text-xs text-danger">{problem}</div> : null}
    </ChatCardShell>
  );
}
