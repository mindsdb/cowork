import * as tls from 'node:tls';
import { performance } from 'node:perf_hooks';
import { diagnostic } from '../shared/diagnostics';

/* Makes the main process's Node TLS clients (https.request, https.get) trust the operating
   system's root certificates as well as Node's bundled ones, as Chromium's own network stack
   already does. A release build's nodeOptions fuse makes Electron remove NODE_EXTRA_CA_CERTS
   from the environment before any app code runs, so a corporate root reaches these clients only
   through the system store, where IT installs it.

   Who can add a root to that store depends on the platform. On macOS and Windows, nothing can
   add one without the user's or an admin's consent. On Linux, Node reads the store from
   OpenSSL's default certificate file and directory, and SSL_CERT_FILE and SSL_CERT_DIR replace
   those paths, so whoever starts the app can add roots here. Chromium on Linux also trusts the
   user's NSS database in ~/.pki/nssdb, which any program running as the user can write.

   This covers two kinds of Node program: main's own clients, through this function, and the Node
   programs the server starts, through NODE_USE_SYSTEM_CA (server-process.ts). The Python server
   itself takes its roots and proxy from the environment it inherits, SSL_CERT_FILE,
   REQUESTS_CA_BUNDLE, CURL_CA_BUNDLE and HTTPS_PROXY included.

   It runs once, after the main window starts loading, and logs how many system roots it read and
   how long the read and the swap took (system_trust_store_read, at INFO). */
export function trustSystemCertificates(): void {
  const startedAt = performance.now();
  try {
    const system = tls.getCACertificates('system');
    if (system.length > 0) tls.setDefaultCACertificates([...tls.getCACertificates('default'), ...system]);
    diagnostic('main.system-trust', 'INFO', 'system_trust_store_read', {
      count: system.length,
      duration_ms: Math.round(performance.now() - startedAt),
    });
  } catch (err) {
    diagnostic('main.system-trust', 'WARNING', 'system_trust_store_not_added', err);
  }
}
