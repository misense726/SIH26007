import { Component, type ErrorInfo, type ReactNode } from "react";

interface DashboardErrorBoundaryProps {
  children: ReactNode;
  resetKey: string;
}

interface DashboardErrorBoundaryState {
  failed: boolean;
}

export class DashboardErrorBoundary extends Component<
  DashboardErrorBoundaryProps,
  DashboardErrorBoundaryState
> {
  state: DashboardErrorBoundaryState = { failed: false };

  static getDerivedStateFromError(): DashboardErrorBoundaryState {
    return { failed: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("FogSen dashboard render failed", error, info.componentStack);
  }

  componentDidUpdate(previousProps: DashboardErrorBoundaryProps) {
    if (this.state.failed && previousProps.resetKey !== this.props.resetKey) {
      this.setState({ failed: false });
    }
  }

  render() {
    if (!this.state.failed) return this.props.children;

    return (
      <section className="dashboard-error" role="alert">
        <p className="eyebrow">Dashboard status</p>
        <h2>View unavailable</h2>
        <p>This view could not be displayed.</p>
        <button type="button" onClick={() => window.location.reload()}>
          Reload dashboard
        </button>
      </section>
    );
  }
}
