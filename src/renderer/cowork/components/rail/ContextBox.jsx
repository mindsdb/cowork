// Context card — project + global memories. Slim variant by default
// per spec ("one line header, no underline").

import { RailCard } from './RailCard';
import { ContextCard } from './ContextCard';

export function ContextBox({
  /** For resolving a stored project slug to its label (ENG-1676). */
  projects = [],
  project,
  /** Conversation / task id — with `project`, lists uploads (GET /v1/attachments/{project}/{session}). */
  conversationId,
  /** Bumps when the task transcript changes (turn finish, send, etc.) so attachments and memory stay in sync. */
  refreshKey,
  defaultOpen = true,
  maxBodyHeight = 360,
  slim = true,
  onAddGoogleDriveFiles,
  onAddSharePointFiles,
  onFetchGoogleDriveFiles,
  onRemoveGoogleDriveFile,
}) {
  return (
    <RailCard title="Context" defaultOpen={defaultOpen} slim={slim} maxBodyHeight={maxBodyHeight}>
      <ContextCard
        projects={projects}
        project={project}
        conversationId={conversationId}
        refreshKey={refreshKey}
        onAddGoogleDriveFiles={onAddGoogleDriveFiles}
        onAddSharePointFiles={onAddSharePointFiles}
        onFetchGoogleDriveFiles={onFetchGoogleDriveFiles}
        onRemoveGoogleDriveFile={onRemoveGoogleDriveFile}
      />
    </RailCard>
  );
}
