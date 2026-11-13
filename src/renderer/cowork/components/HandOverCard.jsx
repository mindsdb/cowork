import { useEffect, useMemo, useState } from 'react';
import { submitAnswer } from '../api';
import { handBackBrowser } from '../lib/browserHandBack';
import { useBrowserHandOver } from '../lib/browserHandOverContext';
import { parseHandOverPrompt } from '../lib/browserHandOverPrompt';
import Ico from './Icons';
import Badge from './ui/Badge';
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
 * the task on, as the browser's Done does after such a turn.
 */
export default function HandOverCard({ step, conversationId, onAnswered, ended = false }) {
  const { t } = useTranslation('chat');
  const q = step?.data || {};
  const parsed = useMemo(() => parseHandOverPrompt(q.prompt), [q.prompt]);
  const { sessionId, paneShown, openBrowser, continueTask, agentLabel } = useBrowserHandOver();
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState('');
  // A new hand-over, or one that ended, takes clicks again.
  useEffect(() => { setBusy(false); setProblem(''); }, [q.question_id, ended]);

  if (!parsed) return null;
  const agent = agentLabel || 'Anton';

  const handBack = async () => {
    if (busy) return;
    setBusy(true);
    setProblem('');
    let sent;
    try {
      sent = await handBackBrowser(sessionId);
    } catch (error) {
      diagnostic('renderer.cowork.hand-over-card', 'WARNING', 'browser_hand_back_failed', error);
      sent = 'none';
    }
    if (sent === 'none') {
      setProblem(t('askUser.handOver.noBrowser'));
      setBusy(false);
      return;
    }
    // The web viewer isn't framed yet: the pane opens, and Done goes once it is.
    if (sent === 'waiting') openBrowser();
    if (ended) continueTask?.();
    // Live, the card stays busy until anton retires it.
    if (ended) setBusy(false);
  };

  const answer = async (value) => {
    if (busy) return;
    setBusy(true);
    const result = await submitAnswer(conversationId, q.question_id, { values: [value] });
    if (result?.status === 'error' || result?.status === 'rejected') setBusy(false);
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
          {parsed.site ? (
            <Badge size="sm" icon={Ico.globe(12)} title={parsed.site} className="min-w-0 max-w-[60%]">
              <span className="truncate">{parsed.site}</span>
            </Badge>
          ) : null}
        </div>
        {/* anton's reason, as the browser's own banner shows it: text, never markdown. */}
        <MarkdownPlainText>{parsed.reason}</MarkdownPlainText>
        <span className="text-xs text-ink-3">{line}</span>
      </div>
      {problem ? <div role="alert" className="mt-2 text-xs text-danger">{problem}</div> : null}
    </ChatCardShell>
  );
}
