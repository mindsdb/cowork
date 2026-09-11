// The one affordance the generic failure card can offer: put everything a
// support reply needs on the clipboard in a single click, so reporting an
// unexplained failure does not start with the user hunting for a log file.
//
// Nothing here leaves the machine. The payload is the version readout plus
// what server:get-diagnostics already exposes, scrubbed — see lib/diagnostics.
import { useEffect, useRef, useState } from 'react';
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
  const busy = useRef(false);

  const onClick = async () => {
    // The gather is two awaits; without this a double click runs both twice.
    if (busy.current) return;
    busy.current = true;
    const baked = typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : '';
    // Degrading is right — a missing version must not cost the user the id and
    // the log — but the cause is named so a support paste reading "—" can be
    // explained rather than guessed at.
    const [versionInfo, diag] = await Promise.all([
      getVersionInfo().catch((err) => { console.warn('[diagnostics] versions unavailable', err); return {}; }),
      host.serverDiagnostics().catch((err) => { console.warn('[diagnostics] server diagnostics unavailable', err); return {}; }),
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
    busy.current = false;
  };

  // Settles back to the idle label on its own, like the version copy control
  // in UpdatesSection — a card can sit on screen for a long time, and a stale
  // "Copied" reads as though the last click is still in effect.
  useEffect(() => {
    if (state === 'idle') return undefined;
    const timer = setTimeout(() => setState('idle'), 1500);
    return () => clearTimeout(timer);
  }, [state]);

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
