import type { CodingSession, TaskCapabilities } from './api';

export type TaskCapabilityName = keyof TaskCapabilities;

/**
 * Runtime-advertised capabilities are authoritative. Older local sessions
 * predate the contract and remain fully usable; older remote sessions fail
 * closed so the desktop never offers an operation the connected runtime may
 * not understand.
 */
export function supportsTaskCapability(
  session: Pick<CodingSession, 'task_capabilities' | 'computer_is_local'>,
  capability: TaskCapabilityName,
): boolean {
  if (session.task_capabilities) return session.task_capabilities[capability];
  return session.computer_is_local !== false;
}
