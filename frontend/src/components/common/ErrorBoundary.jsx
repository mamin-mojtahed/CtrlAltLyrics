import React from 'react';

export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    console.error('ErrorBoundary caught error:', error, errorInfo);
  }

  handleReset = () => {
    this.setState({ hasError: false, error: null });
  };

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback;
      }
      return (
        <div style={{
          padding: '1.5rem',
          margin: '1rem',
          background: 'rgba(239, 68, 68, 0.15)',
          border: '1px solid rgba(239, 68, 68, 0.4)',
          borderRadius: '12px',
          color: '#fca5a5',
          fontFamily: 'sans-serif'
        }}>
          <h3 style={{ margin: '0 0 0.5rem 0', color: '#ef4444', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <span>⚠️</span> Something went wrong in this section
          </h3>
          <p style={{ margin: '0 0 1rem 0', fontSize: '0.85rem', color: '#fecaca', wordBreak: 'break-word' }}>
            {this.state.error?.message || 'An unexpected rendering error occurred.'}
          </p>
          <button
            type="button"
            onClick={this.handleReset}
            style={{
              padding: '0.4rem 0.8rem',
              background: '#ef4444',
              color: '#ffffff',
              border: 'none',
              borderRadius: '6px',
              cursor: 'pointer',
              fontWeight: 600,
              fontSize: '0.8rem'
            }}
          >
            Retry
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}
