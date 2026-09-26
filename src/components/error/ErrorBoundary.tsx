import { Component } from "react";
import type { ErrorInfo, ReactNode } from "react";
import { AlertTriangle, RefreshCw } from "lucide-react";
import i18n from "@/i18n/config";
import { Button } from "@/components/ui/Button";

interface ErrorBoundaryProps {
  children: ReactNode;
  fallback?: ReactNode;
  /** When true, renders a full-screen error (for top-level boundaries). */
  fullScreen?: boolean;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(_error: Error, _info: ErrorInfo) {
    // Error is already captured in state via getDerivedStateFromError.
    // Logging is handled by tracing on the backend side.
  }

  handleReload = () => {
    this.setState({ hasError: false, error: null });
  };

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) return this.props.fallback;

      const containerClass = this.props.fullScreen
        ? "flex flex-col items-center justify-center h-screen gap-4 p-8 text-center"
        : "flex flex-col items-center justify-center min-h-64 gap-4 p-8 text-center";

      return (
        <div className={containerClass}>
          <AlertTriangle className="w-6 h-6 text-danger" />
          <div>
            <p className="text-sm font-semibold text-foreground">
              {i18n.t("error.somethingWentWrong")}
            </p>
            {this.state.error && (
              <p className="mt-1 text-xs text-muted-foreground max-w-sm font-mono">
                {this.state.error.message}
              </p>
            )}
          </div>
          <Button variant="primary" size="md" onClick={this.handleReload} icon={<RefreshCw className="w-3.5 h-3.5" />}>
            {i18n.t("error.tryAgain")}
          </Button>
        </div>
      );
    }

    return this.props.children;
  }
}
