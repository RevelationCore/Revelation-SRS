import { Component, type ErrorInfo, type ReactNode } from 'react';
import { Problem } from './Problem.js';

interface Props {
  children:  ReactNode;
  fallback?: ReactNode;
}

interface State {
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  override state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[ErrorBoundary]', error, info.componentStack);
  }

  override render() {
    if (this.state.error) {
      return (
        this.props.fallback ?? (
          <Problem
            title="Something went wrong"
            detail={this.state.error.message}
          />
        )
      );
    }
    return this.props.children;
  }
}
