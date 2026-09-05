import { RailCard } from './RailCard';
import { PhaseProgress } from '../thinking/PhaseProgress';

export function ProgressBox({
  steps = [],
  streamStatus = null,
  conversationId = '',
  onActivateStep,
  defaultOpen = true,
  maxBodyHeight = 300,
}) {
  return (
    <RailCard title="Progress" defaultOpen={defaultOpen} maxBodyHeight={maxBodyHeight}>
      <PhaseProgress
        steps={steps}
        streamStatus={streamStatus || (steps.length ? 'done' : null)}
        conversationId={conversationId}
        onActivateStep={onActivateStep}
      />
    </RailCard>
  );
}
