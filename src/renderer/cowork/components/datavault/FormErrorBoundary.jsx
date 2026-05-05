// Error boundary specifically for the data-vault form panel. The
// panel renders user-controlled markdown blocks (the `data-vault-form`
// JSON spec from anton's response) — a malformed spec or a render
// glitch shouldn't take down the whole chat surface. Anything that
// throws inside DataVaultFormPanel falls through to a small inline
// notice with the error message; the rest of the app keeps working.

import { Component } from 'react';

export class FormErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    // eslint-disable-next-line no-console
    console.error('[DataVaultFormPanel] render crash', error, info);
  }

  render() {
    if (this.state.error) {
      return (
        <div style={{
          margin: '8px 0',
          padding: '10px 12px',
          borderRadius: 8,
          background: 'color-mix(in srgb, var(--danger) 10%, var(--surface))',
          border: '1px solid color-mix(in srgb, var(--danger) 30%, transparent)',
          color: 'var(--danger)',
          fontFamily: 'var(--font-body)', fontSize: 12.5,
        }}>
          Form panel crashed: <code style={{ fontFamily: 'var(--font-mono)' }}>{String(this.state.error?.message || this.state.error)}</code>
        </div>
      );
    }
    return this.props.children;
  }
}
