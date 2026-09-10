import type { DashboardRole } from "../auth/roleSession";

export type DashboardView = "DRIVER" | "SPATIAL" | "SUPERVISOR" | "SETTINGS";
export type DashboardWorkspace = "DRIVER" | "SUPERVISOR";

export interface DashboardViewOption {
  value: DashboardView;
  label: string;
  hash: string;
  workspace: DashboardWorkspace;
  description: string;
}

interface DashboardRolePolicy {
  label: string;
  homeView: DashboardView;
  views: readonly DashboardView[];
}

export const dashboardViews: DashboardViewOption[] = [
  { value: "DRIVER", label: "Awareness", hash: "#driver", workspace: "DRIVER", description: "Camera and corridor" },
  { value: "SPATIAL", label: "Spatial", hash: "#spatial", workspace: "DRIVER", description: "Range field" },
  { value: "SETTINGS", label: "Calibration", hash: "#calibration", workspace: "DRIVER", description: "Sensor setup" },
  { value: "SUPERVISOR", label: "Fleet", hash: "#fleet", workspace: "SUPERVISOR", description: "Fleet command" },
];

const rolePolicies: Record<DashboardRole, DashboardRolePolicy> = {
  DRIVER: {
    label: "Driver",
    homeView: "DRIVER",
    views: ["DRIVER", "SPATIAL", "SETTINGS"],
  },
  SUPERVISOR: {
    label: "Supervisor",
    homeView: "SUPERVISOR",
    views: ["SUPERVISOR"],
  },
};

const viewByHash = new Map(dashboardViews.map((view) => [view.hash, view.value]));

export function dashboardViewFromHash(hash: string): DashboardView {
  return viewByHash.get(hash.toLowerCase()) ?? "DRIVER";
}

export function dashboardViewsForRole(role: DashboardRole): DashboardViewOption[] {
  const allowedViews = rolePolicies[role].views;
  return dashboardViews.filter((view) => allowedViews.includes(view.value));
}

export function defaultDashboardView(role: DashboardRole): DashboardView {
  return rolePolicies[role].homeView;
}

export function dashboardRoleLabel(role: DashboardRole): string {
  return rolePolicies[role].label;
}

export function isDashboardViewAllowed(role: DashboardRole, view: DashboardView): boolean {
  return rolePolicies[role].views.includes(view);
}

export function resolveDashboardRoute(
  role: DashboardRole,
  requestedDestination: string,
): { view: DashboardView; hash: string } {
  const requestedView = requestedDestination.startsWith("#")
    ? viewByHash.get(requestedDestination.toLowerCase())
    : dashboardViews.find((view) => view.value === requestedDestination)?.value;
  const view = requestedView && isDashboardViewAllowed(role, requestedView)
    ? requestedView
    : defaultDashboardView(role);
  return { view, hash: dashboardViewHash(view) };
}

export function dashboardViewHash(view: DashboardView): string {
  return dashboardViews.find((candidate) => candidate.value === view)?.hash ?? "#driver";
}

export function dashboardViewLabel(view: DashboardView): string {
  return dashboardViews.find((candidate) => candidate.value === view)?.label ?? "Awareness";
}
