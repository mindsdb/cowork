import * as tls from 'node:tls';
import { diagnostic } from '../shared/diagnostics';

/* Makes the main process's Node TLS clients (https.request, https.get) trust the operating
   system's root certificates as well as Node's bundled ones, as Chromium's own network stack
   already does. A release build's nodeOptions fuse makes Electron remove NODE_EXTRA_CA_CERTS
   from the environment before any app code runs, so a corporate root reaches these clients only
   through the system store, where IT installs it and where nothing can add one without the
   user's or an admin's consent. Reading the store takes tens of milliseconds, once. */
export function trustSystemCertificates(): void {
  try {
    const system = tls.getCACertificates('system');
    if (system.length === 0) return;
    tls.setDefaultCACertificates([...tls.getCACertificates('default'), ...system]);
  } catch (err) {
    diagnostic('main.system-trust', 'WARNING', 'system_trust_store_not_added', err);
  }
}
