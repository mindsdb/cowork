// Progress card — the three-phase Thinking → Working → Reasoning rail
// for a streaming or completed turn. Chat-only; project view doesn't
// surface this since there's no live stream there.

import { RailCard } from './RailCard';
import { PhaseProgress } from '../thinking/PhaseProgress';
import { useTranslation } from '../../../lib/i18n';

export function ProgressBox({
  steps = [],
  streamStatus = null,
  conversationId = '',
  onActivateStep,
  defaultOpen = true,
}) {
  const { t } = useTranslation('shell');
  return (
    <RailCard title={t('rail.progress.title')} defaultOpen={defaultOpen}>
      <PhaseProgress
        steps={steps}
        streamStatus={streamStatus || (steps.length ? 'done' : null)}
        conversationId={conversationId}
        onActivateStep={onActivateStep}
      />
    </RailCard>
  );
}
