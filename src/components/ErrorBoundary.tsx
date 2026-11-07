import { Component, type ErrorInfo, type ReactNode } from "react";
import { Button } from "./ui/button.tsx";

/**
 * Shows what failed, and a way to reload, in place of a page that crashed. A part of the
 * app that fails to load after a new deployment is the usual cause, and a reload fixes it.
 */
export class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  override state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error): { error: Error } {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error(error, info.componentStack);
  }

  override render(): ReactNode {
    if (this.state.error === null) return this.props.children;
    return (
      <div className="grid min-h-screen place-items-center p-6">
        <div className="grid w-full max-w-md gap-4">
          <p className="error-box break-words">{this.state.error.message}</p>
          <Button variant="primary" className="w-fit" onClick={() => window.location.reload()}>
            Reload
          </Button>
        </div>
      </div>
    );
  }
}
