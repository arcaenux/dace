import { Component, ErrorInfo, ReactNode } from "react";

interface WorkspaceErrorBoundaryProps {
  children: ReactNode;
  workspace: string;
}

interface WorkspaceErrorBoundaryState {
  error: Error | null;
}

/**
 * Isolates runtime errors within a single workspace view.
 * A crash in one panel never takes down the entire shell.
 */
export class WorkspaceErrorBoundary extends Component<
  WorkspaceErrorBoundaryProps,
  WorkspaceErrorBoundaryState
> {
  constructor(props: WorkspaceErrorBoundaryProps) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error: Error): WorkspaceErrorBoundaryState {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error(`[WorkspaceErrorBoundary] Crash in "${this.props.workspace}":`, error, info);
  }

  handleReset = (): void => {
    this.setState({ error: null });
  };

  override render(): ReactNode {
    const { error } = this.state;
    const { children, workspace } = this.props;

    if (error) {
      return (
        <div className="workspace-error-boundary">
          <div className="workspace-error-card">
            <div className="workspace-error-icon" aria-hidden="true">⚠</div>
            <h2 className="workspace-error-title">Something went wrong</h2>
            <p className="workspace-error-workspace">{workspace}</p>
            <p className="workspace-error-message">
              {error.message || "An unexpected error occurred in this workspace."}
            </p>
            <div className="workspace-error-actions">
              <button
                type="button"
                className="workspace-error-btn primary"
                onClick={this.handleReset}
              >
                Try again
              </button>
              <button
                type="button"
                className="workspace-error-btn"
                onClick={() => window.location.reload()}
              >
                Reload Dace
              </button>
            </div>
            <details className="workspace-error-details">
              <summary>Technical details</summary>
              <pre className="workspace-error-stack">{error.stack}</pre>
            </details>
          </div>
        </div>
      );
    }

    return children;
  }
}
