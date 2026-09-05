import { RailCard } from './RailCard';
import { WorkingFolderLive } from './WorkingFolderLive';

export function WorkingFolderBox({
  project,
  isStreaming = false,
  defaultOpen = true,
  maxBodyHeight = 320,
  conversationId = null,
  onAddressWithAgent,
}) {
  return (
    <RailCard title="Artifacts" defaultOpen={defaultOpen} maxBodyHeight={maxBodyHeight}>
      <WorkingFolderLive
        project={project}
        isStreaming={isStreaming}
        conversationId={conversationId}
        onAddressWithAgent={onAddressWithAgent}
      />
    </RailCard>
  );
}
