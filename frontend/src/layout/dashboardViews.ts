export type DashboardView = "DRIVER" | "SPATIAL" | "SUPERVISOR" | "SETTINGS";

export interface DashboardViewOption {
  value: DashboardView;
  label: string;
  hash: string;
}

export const dashboardViews: DashboardViewOption[] = [
  { value: "DRIVER", label: "Driver", hash: "#driver" },
  { value: "SPATIAL", label: "Spatial", hash: "#spatial" },
  { value: "SUPERVISOR", label: "Fleet", hash: "#fleet" },
  { value: "SETTINGS", label: "Calibration", hash: "#calibration" },
];

const viewByHash = new Map(dashboardViews.map((view) => [view.hash, view.value]));

export function dashboardViewFromHash(hash: string): DashboardView {
  return viewByHash.get(hash.toLowerCase()) ?? "DRIVER";
}

export function dashboardViewHash(view: DashboardView): string {
  return dashboardViews.find((candidate) => candidate.value === view)?.hash ?? "#driver";
}

export function dashboardViewLabel(view: DashboardView): string {
  return dashboardViews.find((candidate) => candidate.value === view)?.label ?? "Driver";
}
