// Context card — project + global memories. Slim variant by default
// per spec ("one line header, no underline").

import { RailCard } from './RailCard';
import { ContextCard } from './ContextCard';

export function ContextBox({
  project,
  /** Conversation / task id — when set, lists attachments assigned to this session (GET /v1/attachments?session_id=…). */
  conversationId,
  /** Bumps when the task transcript changes so attachment assignments after a send are re-fetched. */
  refreshKey,
  defaultOpen = true,
  maxBodyHeight = 360,
  slim = true,
}) {
  return (
    <RailCard title="Context" defaultOpen={defaultOpen} slim={slim} maxBodyHeight={maxBodyHeight}>
      <ContextCard project={project} conversationId={conversationId} refreshKey={refreshKey} />
    </RailCard>
  );
}
