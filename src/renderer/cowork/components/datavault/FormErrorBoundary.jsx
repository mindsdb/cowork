// Contain malformed agent-supplied form specs so a failed panel cannot take down the chat.

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
