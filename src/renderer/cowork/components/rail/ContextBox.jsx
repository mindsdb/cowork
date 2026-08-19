// Context card — project + global memories. Slim variant by default
// per spec ("one line header, no underline").

import { RailCard } from './RailCard';
import { ContextCard } from './ContextCard';

export function ContextBox({
  project,
  /** Conversation / task id — with `project`, lists uploads (GET /v1/attachments/{project}/{session}). */
  conversationId,
  /** Bumps when the task transcript changes (turn finish, send, etc.) so attachments and memory stay in sync. */
  refreshKey,
  defaultOpen = true,
  maxBodyHeight = 360,
  slim = true,
  /** false for harnesses (e.g. Hermes) with no memory system of their own — hides the Project/Global memory sections, keeps attachments/files. */
  showMemory = true,
  onAddGoogleDriveFiles,
  onFetchGoogleDriveFiles,
  onRemoveGoogleDriveFile,
}) {
  return (
    <RailCard title="Context" defaultOpen={defaultOpen} slim={slim} maxBodyHeight={maxBodyHeight}>
      <ContextCard
        project={project}
        conversationId={conversationId}
        refreshKey={refreshKey}
        showMemory={showMemory}
        onAddGoogleDriveFiles={onAddGoogleDriveFiles}
        onFetchGoogleDriveFiles={onFetchGoogleDriveFiles}
        onRemoveGoogleDriveFile={onRemoveGoogleDriveFile}
      />
    </RailCard>
  );
}
