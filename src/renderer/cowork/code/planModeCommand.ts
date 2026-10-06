import type { EngineCommand } from './api';

/** Client-only: selecting /plan changes the composer, never sends a turn. */
export function planModeCommand(enabled: boolean): EngineCommand {
  return { name: 'plan', label: 'Plan mode', description: `Turn plan mode ${enabled ? 'off' : 'on'}`, action: 'client' };
}
