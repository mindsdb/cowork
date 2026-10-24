import { PLATFORM_UI } from './deployment';

/**
 * Whether users pick a conversation's model in a build without the platform UI.
 *
 * - `off`: no picker, and every question runs on the operator's role models.
 * - `default`: the composer's picker, and each new conversation starts on the operator's model.
 * - `open`: the same picker, and a new conversation starts on the user's last pick.
 */
export type ModelPickerMode = 'off' | 'default' | 'open';

/**
 * The operator's picker mode. The Docker SPA wrapper writes it before the renderer starts, and
 * writes no tag for `off`, as desktop never has one. With the platform UI on this is always `off`:
 * that build shows its own picker, settings gear and effort control.
 */
export function modelPickerMode(): ModelPickerMode {
  if (PLATFORM_UI) return 'off';
  const content = document.head.querySelector<HTMLMetaElement>('meta[name="cowork-model-picker"]')?.content;
  return content === 'default' || content === 'open' ? content : 'off';
}
