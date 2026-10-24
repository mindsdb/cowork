// Artifacts card — live list of files anton has produced for the
// project. Used in both chat and project views identically. Renamed
// from "Working folder" because users couldn't tell what that meant;
// "Artifacts" matches the Live Artifacts page's vocabulary and the
// label users see across the rest of the app. On a deployment that runs
// live apps it also renders the "Shared with you" card under Artifacts.

import { useState } from 'react';
import { RailCard } from './RailCard';
import { WorkingFolderLive } from './WorkingFolderLive';
import { SharedLiveApps } from './SharedLiveApps';
import { useLiveApps } from '../../../lib/liveApps';

export function WorkingFolderBox({
  project,
  isStreaming = false,
  defaultOpen = true,
  maxBodyHeight = 320,
  conversationId = null,
  onAddressWithAgent,
}) {
  const liveApps = useLiveApps();
  /*
   * "Shared with you" is a card of its own under Artifacts, and a copy lands
   * in the rail's project. That is the project the parent passes; only a chat
   * with no project falls back to the one the Artifacts card resolved, which
   * it can't update while collapsed. The copy goes back to the Artifacts card
   * once, so it shows at once.
   */
  const [resolvedProjectId, setResolvedProjectId] = useState(null);
  const projectId = project ? (project.id || null) : resolvedProjectId;
  const [receivedCopy, setReceivedCopy] = useState(null);
  return (
    <>
      <RailCard title="Artifacts" defaultOpen={defaultOpen} maxBodyHeight={maxBodyHeight}>
        <WorkingFolderLive
          project={project}
          isStreaming={isStreaming}
          conversationId={conversationId}
          onAddressWithAgent={onAddressWithAgent}
          onProjectResolved={setResolvedProjectId}
          receivedCopy={receivedCopy}
          onReceivedCopyShown={() => setReceivedCopy(null)}
        />
      </RailCard>
      {liveApps && projectId && (
        <SharedLiveApps projectId={projectId} refreshKey={isStreaming} onDuplicated={setReceivedCopy} />
      )}
    </>
  );
}
