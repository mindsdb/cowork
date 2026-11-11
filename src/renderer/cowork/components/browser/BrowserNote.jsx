/* What the pane's privacy note says, folded under one line so it stays out of
   the way: collapsed by default, opened on a click. */

/**
 * @param {{ agentLabel?: string, children: import('react').ReactNode }} props
 */
export function BrowserNote({ agentLabel = 'Anton', children }) {
  return (
    <details className="browser-panel__note">
      <summary>Learn what {agentLabel} sees</summary>
      <p>{children}</p>
    </details>
  );
}
