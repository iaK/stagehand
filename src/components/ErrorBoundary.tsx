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
          <h2 className="text-lg font-semibold text-red-700 dark:text-red-400 mb-2">
            Something went wrong
          </h2>
          <pre className="text-sm bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/20 rounded p-4 overflow-auto whitespace-pre-wrap text-red-800 dark:text-red-300">
            {this.state.error.message}
          </pre>
          {this.state.error.stack && (
            <pre className="text-xs bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 rounded p-4 mt-3 overflow-auto whitespace-pre-wrap text-zinc-600 dark:text-zinc-400 max-h-64">
              {this.state.error.stack}
            </pre>
          )}
          <button
            onClick={() => this.setState({ error: null })}
            className="mt-4 px-4 py-2 bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 rounded text-sm hover:bg-zinc-700 dark:hover:bg-zinc-300"
          >
            Try Again
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
