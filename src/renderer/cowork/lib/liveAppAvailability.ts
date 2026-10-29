/** The authenticated caller's refusal and its durable availability notice. */
export interface LiveAppAvailability {
  scope: string;
  waiting: boolean;
  notice: { id: string; message: string } | null;
}

export function liveAppAvailabilityFrom(value: unknown): LiveAppAvailability {
  if (!value || typeof value !== 'object'
    || !('scope' in value) || typeof value.scope !== 'string' || !value.scope
    || !('waiting' in value) || typeof value.waiting !== 'boolean'
    || !('notice' in value)) {
    throw new TypeError('Invalid live-app availability response');
  }
  const notice = value.notice;
  if (notice === null) return { scope: value.scope, waiting: value.waiting, notice: null };
  if (!notice || typeof notice !== 'object'
    || !('id' in notice) || typeof notice.id !== 'string' || !notice.id
    || !('message' in notice) || typeof notice.message !== 'string' || !notice.message) {
    throw new TypeError('Invalid live-app availability notice');
  }
  return {
    scope: value.scope,
    waiting: value.waiting,
    notice: { id: notice.id, message: notice.message },
  };
}
