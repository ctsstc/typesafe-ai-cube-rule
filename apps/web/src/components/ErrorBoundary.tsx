import { Component, type ReactNode } from "react";

interface State {
  readonly failed: boolean;
}

export class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  override state: State = { failed: false };

  static getDerivedStateFromError(): State {
    return { failed: true };
  }

  override render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div className="container crash" role="alert">
        <h1>The cube collapsed.</h1>
        <p>Something went wrong while drawing the page.</p>
        <button type="button" className="button button--primary" onClick={() => location.reload()}>
          Reload the page
        </button>
      </div>
    );
  }
}
