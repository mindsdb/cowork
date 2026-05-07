// Working folder card — project header + live file list. Used in both
// chat and project views identically.

import { RailCard } from './RailCard';
import { WorkingFolderLive } from './WorkingFolderLive';

export function WorkingFolderBox({
  project,
  isStreaming = false,
  defaultOpen = true,
  maxBodyHeight = 320,
}) {
  return (
    <RailCard title="Working folder" defaultOpen={defaultOpen} maxBodyHeight={maxBodyHeight}>
      <WorkingFolderLive
        project={project}
        isStreaming={isStreaming}
      />
    </RailCard>
  );
}
