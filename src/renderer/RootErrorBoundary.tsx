// Last line of defense for the web entry: a render error anywhere under App
// shows a reload notice instead of unmounting the page to an empty root.

import { Component, type ErrorInfo, type ReactNode } from 'react';
import { WelcomeNotice } from './WelcomeLoading';

type Props = { children: ReactNode };
type State = { error: unknown };

export class RootErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  /** Switch to the notice on the render after a child throws. */
  static getDerivedStateFromError(error: unknown): State {
    return { error };
  }

  /** Log the error with its component stack; the notice carries no details. */
  componentDidCatch(error: unknown, info: ErrorInfo) {
    console.error('[app] render crash', error, info.componentStack);
  }

  /** Render the children, or the reload notice once one of them has thrown. */
  render() {
    if (this.state.error !== null) {
      return (
        <WelcomeNotice
          title="Something went wrong"
          message="Cowork hit an unexpected error. Reload to continue."
          actionLabel="Reload"
          onAction={() => window.location.reload()}
        />
      );
    }
    return this.props.children;
  }
}
