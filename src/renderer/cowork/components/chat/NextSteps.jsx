import { useEffect, useRef, useSyncExternalStore } from 'react';
import Ico from '../Icons';
import { Button } from '../ui';
import { useTranslation } from '../../../lib/i18n';
import { trackNextStepClicked, trackNextStepsShown } from '../../lib/analytics';
import { FILE_STEPS, NEXT_STEP, NEXT_STEP_PROMPTS } from '../../lib/nextSteps';
import { localFileAttachments } from '../../lib/localFileAttachments';
import { isAnswerScheduled, subscribeScheduledAnswers } from '../../lib/scheduledAnswers';

const LABEL_KEYS = {
  [NEXT_STEP.OWN_DATA]: 'chatView.nextSteps.ownData',
  [NEXT_STEP.ANOTHER_FILE]: 'chatView.nextSteps.anotherFile',
  [NEXT_STEP.MAKE_PAGE]: 'chatView.nextSteps.makePage',
  [NEXT_STEP.SCHEDULE]: 'chatView.nextSteps.schedule',
};

const ICONS = {
  [NEXT_STEP.OWN_DATA]: () => Ico.attach(14),
  [NEXT_STEP.ANOTHER_FILE]: () => Ico.attach(14),
  [NEXT_STEP.MAKE_PAGE]: () => Ico.appWindow(14),
  [NEXT_STEP.SCHEDULE]: () => Ico.clock(14),
};

/**
 * A row of next steps under a finished answer. Each one starts without
 * typing: a file step opens the file picker and sends once files are picked,
 * the schedule step opens the schedule form, and the rest send at once.
 */
export function NextSteps({ answerKey, resultKind, steps, onSend, onSchedule }) {
  const { t } = useTranslation('chat');
  const fileInputRef = useRef(null);
  const pendingStepRef = useRef(null);

  // Once a schedule is saved from this answer, its step reads as done, so a
  // second click can't make a duplicate.
  const scheduled = useSyncExternalStore(
    subscribeScheduledAnswers,
    () => isAnswerScheduled(answerKey),
    () => false,
  );

  useEffect(() => {
    trackNextStepsShown(answerKey, { resultKind, steps });
  }, [answerKey, resultKind, steps]);

  if (!steps?.length) return null;

  const run = (step, position) => {
    trackNextStepClicked({ step, resultKind, position });
    if (step === NEXT_STEP.SCHEDULE) {
      onSchedule?.();
      return;
    }
    if (FILE_STEPS.has(step)) {
      pendingStepRef.current = step;
      fileInputRef.current?.click();
      return;
    }
    onSend?.(NEXT_STEP_PROMPTS[step], []);
  };

  const onFilesPicked = (event) => {
    const step = pendingStepRef.current;
    const files = event.target.files;
    pendingStepRef.current = null;
    if (step && files?.length) onSend?.(NEXT_STEP_PROMPTS[step], localFileAttachments(files));
    event.target.value = '';
  };

  return (
    <div className="mt-3 flex flex-wrap gap-2" role="group" aria-label={t('chatView.nextSteps.groupLabel')} data-testid="next-steps">
      {steps.map((step, position) => (step === NEXT_STEP.SCHEDULE && scheduled ? (
        <Button key={step} variant="tinted" size="sm" disabled>
          {ICONS[step]?.()}
          {t('chatView.nextSteps.scheduledDone')}
        </Button>
      ) : (
        <Button key={step} variant="tinted" size="sm" onClick={() => run(step, position)}>
          {ICONS[step]?.()}
          {t(LABEL_KEYS[step])}
        </Button>
      )))}
      <input
        ref={fileInputRef}
        type="file"
        multiple
        hidden
        aria-hidden="true"
        tabIndex={-1}
        data-testid="next-steps-file-input"
        onChange={onFilesPicked}
      />
    </div>
  );
}

export default NextSteps;
