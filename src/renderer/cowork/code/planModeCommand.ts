import type { EngineCommand } from './api';
import i18n from '../../lib/i18n';

/** Client-only: selecting /plan changes the composer, never sends a turn. */
export function planModeCommand(enabled: boolean): EngineCommand {
  return { name: 'plan', label: i18n.t('planModeCommand.label', { ns: 'code' }), description: i18n.t(enabled ? 'planModeCommand.turnOff' : 'planModeCommand.turnOn', { ns: 'code' }), action: 'client' };
}
