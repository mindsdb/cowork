// The one affordance the generic failure card can offer: put everything a
// support reply needs on the clipboard in a single click, so reporting an
// unexplained failure does not start with the user hunting for a log file.
//
// Nothing here leaves the machine. The payload is the version readout plus
// what server:get-diagnostics already exposes, scrubbed — see lib/diagnostics.
import { useState } from 'react';
import { copyText } from '../lib/clipboard';
import { diagnosticsText } from '../lib/diagnostics';
import { versionRows } from '../lib/versionRows';
import { host, getVersionInfo } from '../../platform/host';

const LABELS = { idle: 'Copy diagnostics', copied: 'Copied', failed: "Couldn't copy" };

/**
 * @param {object} props
 * @param {string} props.requestId The turn's server-side correlation id.
 * @param {string} props.code The failure's wire code.
 * @param {object} [props.health] The last /health snapshot; supplies the
 *   server and agent versions. Read rather than re-fetched because the turn
 *   may have failed precisely because the server is gone.
 */
export default function CopyDiagnosticsButton({ requestId, code, health }) {
  const [state, setState] = useState('idle');

  const onClick = async () => {
    const baked = typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : '';
    const [versionInfo, diag] = await Promise.all([
      getVersionInfo().catch(() => ({})),
      host.serverDiagnostics().catch(() => ({})),
    ]);
    const text = diagnosticsText({
      rows: versionRows({
        versionInfo,
        bakedVersion: baked,
        serverVersion: health?.server_version || '',
        antonVersion: health?.anton_version || '',
      }),
      requestId,
      code,
      log: diag?.recentLog,
    });
    setState(await copyText(text) ? 'copied' : 'failed');
  };

  return (
    // The live region wraps the button because the failure text IS the label —
    // same reasoning as the version copy control in UpdatesSection.
    <span role="status" aria-live="polite">
      <button
        type="button"
        onClick={onClick}
        onBlur={() => setState('idle')}
        className="bg-transparent border-none p-0 cursor-pointer text-accent text-xs"
      >
        {LABELS[state]}
      </button>
    </span>
  );
}
