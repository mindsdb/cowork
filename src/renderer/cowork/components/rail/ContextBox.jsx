// Context card — project + global memories. Slim variant by default
// per spec ("one line header, no underline").

import { RailCard } from './RailCard';
import { ContextCard } from './ContextCard';
import { useTranslation } from '../../../lib/i18n';

export function ContextBox({
  /** For resolving a stored project slug to its label (ENG-1676). */
  projects = [],
  project,
  /** Conversation / task id — with `project`, lists uploads (GET /v1/attachments/{project}/{session}). */
  conversationId,
  /** Bumps when the task transcript changes (turn finish, send, etc.) so attachments and memory stay in sync. */
  refreshKey,
  defaultOpen = true,
  onAddGoogleDriveFiles,
  onAddSharePointFiles,
  onFetchGoogleDriveFiles,
  onRemoveGoogleDriveFile,
}) {
  const { t } = useTranslation('shell');
  return (
    <RailCard title={t('rail.context.title')} defaultOpen={defaultOpen}>
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
