import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { CapacitorConfig } from '@capacitor/cli';
import { COWORK_URLS, resolveCoworkEnv } from './env';

// Contract with the web app (ENG-4023): app id, remote URL, user-agent suffix
// and the MindsHubAuth plugin. See README.md before changing any of them.

const env = resolveCoworkEnv(process.env.COWORK_ENV);
const remoteUrl = COWORK_URLS[env];

// Marketing version (CFBundleShortVersionString / versionName) comes from
// package.json; the native projects read the same file, so the UA suffix and
// the store version cannot drift apart.
const { version } = JSON.parse(readFileSync(join(__dirname, 'package.json'), 'utf8')) as {
  version: string;
};

const config: CapacitorConfig = {
  appId: 'ai.mindshub.cowork',
  appName: 'MindsHub Cowork',
  webDir: 'www',
  server: {
    url: remoteUrl,
    cleartext: false,
    // Only our own hosts stay inside the webview; everything else opens in
    // the system browser.
    allowNavigation: [new URL(COWORK_URLS.prod).host, new URL(COWORK_URLS.staging).host],
    // Bundled page shown when the remote app fails to load.
    errorPath: 'offline.html',
  },
  ios: {
    appendUserAgent: `MindsHubCowork-iOS/${version}`,
    // Draw under the status bar / home indicator; the page pads itself with
    // env(safe-area-inset-*).
    contentInset: 'never',
    backgroundColor: '#0E1518',
  },
  android: {
    appendUserAgent: `MindsHubCowork-Android/${version}`,
    allowMixedContent: false,
    backgroundColor: '#0E1518',
  },
  plugins: {
    SystemBars: {
      insetsHandling: 'css',
      initialViewportFitValueHint: 'cover',
    },
    StatusBar: {
      overlaysWebView: true,
    },
    SplashScreen: {
      launchShowDuration: 0,
      launchAutoHide: true,
      backgroundColor: '#0E1518',
      showSpinner: false,
    },
  },
};

export default config;
