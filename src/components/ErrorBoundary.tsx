import { Component, type ErrorInfo, type ReactNode } from "react";

interface Props {
  children: ReactNode;
}
interface State {
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("[Harbor] Unhandled render error:", error, info.componentStack);
  }

  render() {
    if (this.state.error) {
      return (
        <div className="flex h-full flex-col items-center justify-center gap-4 bg-surface-pane px-8 text-center">
          <div className="flex h-14 w-14 items-center justify-center rounded-[14px] bg-danger/10 text-danger">
            <span className="text-2xl">⚠</span>
          </div>
          <div>
            <p className="text-[14px] font-semibold text-text-primary">Something went wrong</p>
            <p className="mt-1 text-[12px] text-text-secondary">
              A component crashed unexpectedly. Reload the app to continue.
            </p>
            <pre className="mt-3 max-h-32 overflow-auto rounded-input border border-border-raised bg-surface-colheader px-3 py-2 text-left font-mono text-[10.5px] text-danger">
              {this.state.error.message}
            </pre>
          </div>
          <button
            onClick={() => {
              this.setState({ error: null });
            }}
            className="rounded-input border border-border-input bg-surface-chip px-4 py-2 text-[12.5px] font-medium text-text-primary transition-colors hover:bg-surface-hover"
          >
            Try to recover
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
