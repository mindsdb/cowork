// Error boundary specifically for the data-vault form panel. The
// panel renders user-controlled markdown blocks (the `data-vault-form`
// JSON spec from anton's response) — a malformed spec or a render
// glitch shouldn't take down the whole chat surface. Anything that
// throws inside DataVaultFormPanel falls through to a small inline
// notice with the error message; the rest of the app keeps working.

import { Component } from 'react';
import { Alert } from '../ui';

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
        <Alert variant="danger" className="my-2">
          Form panel crashed: <code style={{ fontFamily: 'var(--font-mono)' }}>{String(this.state.error?.message || this.state.error)}</code>
        </Alert>
      );
    }
    return this.props.children;
  }
}
