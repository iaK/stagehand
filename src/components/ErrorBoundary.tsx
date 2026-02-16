import { Component, type ReactNode } from "react";

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error("React error boundary caught:", error, info.componentStack);
  }

  render() {
    if (this.state.error) {
      return (
        <div className="p-6 max-w-2xl mx-auto mt-12">
          <h2 className="text-lg font-semibold text-red-700 mb-2">
            Something went wrong
          </h2>
          <pre className="text-sm bg-red-50 border border-red-200 rounded p-4 overflow-auto whitespace-pre-wrap text-red-800">
            {this.state.error.message}
          </pre>
          {this.state.error.stack && (
            <pre className="text-xs bg-zinc-50 border border-zinc-200 rounded p-4 mt-3 overflow-auto whitespace-pre-wrap text-zinc-600 max-h-64">
              {this.state.error.stack}
            </pre>
          )}
          <button
            onClick={() => this.setState({ error: null })}
            className="mt-4 px-4 py-2 bg-zinc-900 text-white rounded text-sm hover:bg-zinc-700"
          >
            Try Again
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
