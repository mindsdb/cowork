// Artifacts card — live list of files anton has produced for the
// project. Used in both chat and project views identically. Renamed
// from "Working folder" because users couldn't tell what that meant;
// "Artifacts" matches the Live Artifacts page's vocabulary and the
// label users see across the rest of the app.

import { RailCard } from './RailCard';
import { WorkingFolderLive } from './WorkingFolderLive';

export function WorkingFolderBox({
  project,
  isStreaming = false,
  defaultOpen = true,
  maxBodyHeight = 320,
}) {
  return (
    <RailCard title="Artifacts" defaultOpen={defaultOpen} maxBodyHeight={maxBodyHeight}>
      <WorkingFolderLive
        project={project}
        isStreaming={isStreaming}
      />
    </RailCard>
  );
}
