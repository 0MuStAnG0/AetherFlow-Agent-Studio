import { Component, type ErrorInfo, type ReactNode } from 'react';
import { AlertTriangle, RotateCcw } from 'lucide-react';

interface ErrorBoundaryProps {
  children: ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  errorMessage: string;
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  public state: ErrorBoundaryState = {
    hasError: false,
    errorMessage: '',
  };

  public static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return {
      hasError: true,
      errorMessage: error.message || 'Unexpected rendering error occurred.',
    };
  }

  public componentDidCatch(_error: Error, _info: ErrorInfo): void {
    // Error details are captured in component state for operator recovery.
  }

  private handleReset = () => {
    this.setState({ hasError: false, errorMessage: '' });
  };

  private handleReload = () => {
    window.location.reload();
  };

  public render() {
    if (this.state.hasError) {
      return (
        <div
          role="alert"
          className="flex min-h-screen items-center justify-center bg-slate-50 p-6 text-slate-900 dark:bg-slate-950 dark:text-slate-100"
        >
          <div className="w-full max-w-md rounded-xl border border-rose-200 bg-white p-6 shadow-sm dark:border-rose-900/60 dark:bg-slate-900">
            <div className="flex items-start gap-3">
              <div className="rounded-lg border border-rose-200 bg-rose-50 p-2 text-rose-700 dark:border-rose-900/60 dark:bg-rose-950/60 dark:text-rose-400">
                <AlertTriangle className="h-5 w-5" />
              </div>
              <div className="min-w-0 flex-1">
                <h1 className="font-display text-base font-bold text-slate-900 dark:text-slate-100">
                  Studio Interface Error
                </h1>
                <p className="mt-1 text-xs leading-relaxed text-slate-600 dark:text-slate-400">
                  A component encountered an unexpected state. You can reset the view or reload the workspace without losing saved SQLite workflows.
                </p>
              </div>
            </div>

            {this.state.errorMessage && (
              <pre className="mt-4 max-h-32 overflow-auto rounded-lg border border-slate-200 bg-slate-50 p-2.5 font-mono text-[11px] text-rose-700 dark:border-slate-800 dark:bg-slate-950 dark:text-rose-300">
                {this.state.errorMessage}
              </pre>
            )}

            <div className="mt-5 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={this.handleReset}
                className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
              >
                Try Recover
              </button>
              <button
                type="button"
                onClick={this.handleReload}
                className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-3.5 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-slate-800 dark:bg-blue-600 dark:hover:bg-blue-700"
              >
                <RotateCcw className="h-3.5 w-3.5" />
                Reload Studio
              </button>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
