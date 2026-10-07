import React from 'react';
import { AlertTriangle, RefreshCw, Home } from 'lucide-react';

/**
 * Catches render-time crashes anywhere below it and replaces the unmounted
 * tree with a recoverable screen.
 *
 * Without this, any thrown render error in a lazy route unmounts the entire
 * React tree and the user is left staring at the empty `#root` element, with
 * no way back except a manual refresh.
 */

interface Props {
  children: React.ReactNode;
}

interface State {
  error: Error | null;
  info: string | null;
}

export class ErrorBoundary extends React.Component<Props, State> {
  state: State = { error: null, info: null };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    // Keep the component stack for diagnosis; the user-facing copy stays generic.
    this.setState({ info: info.componentStack ?? null });
    console.error('Unhandled UI error:', error, info.componentStack);
  }

  private handleRetry = () => {
    this.setState({ error: null, info: null });
  };

  private handleReload = () => {
    window.location.reload();
  };

  private handleHome = () => {
    window.location.assign('/');
  };

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;

    return (
      <div className="boot-fallback" role="alert">
        <div
          className="boot-fallback-card"
          style={{
            maxWidth: 480,
            textAlign: 'center',
            padding: '32px 28px',
            borderRadius: 14,
            background: 'var(--surface, #fff)',
            border: '1px solid var(--border, #e2e8f0)',
            boxShadow: '0 10px 30px rgba(15, 23, 42, 0.08)'
          }}
        >
          <AlertTriangle
            size={38}
            color="var(--green-800, #12603d)"
            style={{ marginBottom: 12 }}
            aria-hidden
          />
          <h1 style={{ fontSize: 20, fontWeight: 800, margin: '0 0 8px' }}>
            This page ran into a problem
          </h1>
          <p
            style={{
              fontSize: 14,
              lineHeight: 1.6,
              color: 'var(--text-secondary, #55675b)',
              margin: '0 0 20px'
            }}
          >
            Something failed while drawing this screen. Your account and data are
            unaffected. Try again, or go back to the home page.
          </p>

          <details style={{ textAlign: 'left', marginBottom: 18 }}>
            <summary
              style={{
                cursor: 'pointer',
                fontSize: 12,
                fontWeight: 700,
                color: 'var(--text-secondary, #55675b)'
              }}
            >
              Technical details
            </summary>
            <pre
              style={{
                marginTop: 8,
                padding: 10,
                fontSize: 11,
                lineHeight: 1.5,
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-word',
                maxHeight: 180,
                overflow: 'auto',
                borderRadius: 8,
                background: 'var(--surface-alt, #f4f8f5)',
                color: 'var(--text-primary, #1a2e1a)'
              }}
            >
              {error.message}
              {this.state.info ? `\n${this.state.info}` : ''}
            </pre>
          </details>

          <div
            style={{
              display: 'flex',
              gap: 10,
              justifyContent: 'center',
              flexWrap: 'wrap'
            }}
          >
            <button type="button" className="btn btn-primary" onClick={this.handleRetry}>
              <RefreshCw size={15} style={{ marginRight: 6 }} aria-hidden />
              Try again
            </button>
            <button type="button" className="btn btn-secondary" onClick={this.handleReload}>
              Reload page
            </button>
            <button type="button" className="btn btn-secondary" onClick={this.handleHome}>
              <Home size={15} style={{ marginRight: 6 }} aria-hidden />
              Go to home
            </button>
          </div>
        </div>
      </div>
    );
  }
}