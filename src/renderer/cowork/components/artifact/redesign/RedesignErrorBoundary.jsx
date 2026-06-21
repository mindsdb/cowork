import { Component } from 'react';

// Wraps the redesigned workspace so a runtime error renders a readable panel
// (with the message + how to fall back to legacy) instead of white-screening
// the whole app. direction-2 is build-verified but, until it's fully
// click-tested, a render-time error is possible — this makes any such error
// visible and recoverable rather than silent.
export class RedesignErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    // eslint-disable-next-line no-console
    console.error('[direction-2] redesign workspace crashed:', error, info && info.componentStack);
  }

  render() {
    if (this.state.error) {
      const msg = String((this.state.error && this.state.error.message) || this.state.error);
      const stack = (this.state.error && this.state.error.stack) || '';
      const box = {
        background: '#0E1626', border: '1px solid #1E2A44', borderRadius: 10,
        padding: 16, whiteSpace: 'pre-wrap', fontSize: 12.5, overflow: 'auto',
      };
      return (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 9999, background: '#080d18', color: '#F2F6FF',
          fontFamily: '-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif', padding: 40, overflow: 'auto',
        }}>
          <div style={{ maxWidth: 780, margin: '0 auto' }}>
            <div style={{ fontSize: 18, fontWeight: 700, color: '#F87171', marginBottom: 8 }}>
              Redesign workspace hit a runtime error
            </div>
            <div style={{ color: '#C7D2E5', lineHeight: 1.55, marginBottom: 16 }}>
              This is the <b>direction-2</b> redesign. Please screenshot this for Claude to fix.
              To switch back to the legacy workspace, run in the console then reload:{' '}
              <code style={{ background: '#131D31', padding: '2px 6px', borderRadius: 4, color: '#22D3EE' }}>
                localStorage.setItem('anton:artifact-workspace-direction-2','false')
              </code>
            </div>
            <div style={{ ...box, color: '#F87171' }}>{msg}</div>
            <div style={{ ...box, color: '#8A97AE', fontSize: 11.5, marginTop: 12 }}>{stack}</div>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

export default RedesignErrorBoundary;
