// Status badge for the four Browser Control bridge states. Reuses the
// ChannelsView StatusBadge visual vocabulary (channels-badge + LED dot):
//   disconnected     -> idle   (inert grey)
//   awaiting-approval -> warn   (amber, pending)
//   connected        -> ok     (green, pulsing LED)
//   lost             -> danger (red)
// See /code/.plans/designs/browser-control-states-*.html.

const STATE_META = {
  disconnected: { tone: 'idle', label: 'Disconnected' },
  'awaiting-approval': { tone: 'warn', label: 'Awaiting approval' },
  connected: { tone: 'ok', label: 'Connected' },
  lost: { tone: 'danger', label: 'Connection lost' },
};

export default function BrowserControlBadge({ state }) {
  const meta = STATE_META[state] || STATE_META.disconnected;
  return (
    <span
      className={`channels-badge channels-badge-${meta.tone}`}
      role="status"
      aria-label={`Browser Control: ${meta.label}`}
    >
      <span className="channels-led" aria-hidden="true" />
      {meta.label}
    </span>
  );
}
