import { host } from '../../platform/host';
import { PLATFORM_UI } from '../../lib/deployment';

// Where the web build lists what only the desktop app can do. The desktop app
// keeps its own entries; a self-hosted build has no app of ours to offer; the
// mobile app cannot install it. A phone's browser is not excluded and still
// sees the offer. Kept out of host.ts, which harnesses load without the
// build's constants.
export function desktopOfferAvailable() {
  return PLATFORM_UI && host.isWeb && !host.isMobileShell;
}

// Every web referral starts `cowork-web` so the download page's counts stay
// comparable with the untagged-per-feature baseline.
export const DESKTOP_DOWNLOAD_FROM = {
  code_mode: 'cowork-web-code',
  local_folder: 'cowork-web-folder',
  connector: 'cowork-web-connector',
  fullstack_app: 'cowork-web-app',
};

export function desktopDownloadUrl(feature) {
  const from = DESKTOP_DOWNLOAD_FROM[feature] || 'cowork-web';
  return `https://mindshub.ai/download?os=auto&from=${from}`;
}
