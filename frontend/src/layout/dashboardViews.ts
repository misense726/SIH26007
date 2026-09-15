export type DashboardView = "DRIVER" | "SPATIAL" | "SUPERVISOR" | "SETTINGS";
export type DashboardWorkspace = "DRIVER" | "SUPERVISOR";

export interface DashboardViewOption {
  value: DashboardView;
  label: string;
  hash: string;
  workspace: DashboardWorkspace;
  description: string;
}

export const dashboardViews: DashboardViewOption[] = [
  { value: "DRIVER", label: "Awareness", hash: "#driver", workspace: "DRIVER", description: "Camera and corridor" },
  { value: "SPATIAL", label: "Spatial", hash: "#spatial", workspace: "DRIVER", description: "Range field" },
  { value: "SETTINGS", label: "Calibration", hash: "#calibration", workspace: "DRIVER", description: "Sensor setup" },
  { value: "SUPERVISOR", label: "Supervisor", hash: "#fleet", workspace: "SUPERVISOR", description: "Fleet command" },
];

const viewByHash = new Map(dashboardViews.map((view) => [view.hash, view.value]));

export function dashboardViewFromHash(hash: string): DashboardView {
  return viewByHash.get(hash.toLowerCase()) ?? "DRIVER";
}

export function dashboardViewHash(view: DashboardView): string {
  return dashboardViews.find((candidate) => candidate.value === view)?.hash ?? "#driver";
}

export function dashboardViewLabel(view: DashboardView): string {
  return dashboardViews.find((candidate) => candidate.value === view)?.label ?? "Awareness";
}
