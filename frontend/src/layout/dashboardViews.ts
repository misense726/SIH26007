export type DashboardView = "DRIVER" | "SPATIAL" | "SUPERVISOR" | "SETTINGS";

export interface DashboardViewOption {
  value: DashboardView;
  label: string;
}

export const dashboardViews: DashboardViewOption[] = [
  { value: "DRIVER", label: "Driver" },
  { value: "SPATIAL", label: "Spatial view" },
  { value: "SUPERVISOR", label: "Supervisor" },
  { value: "SETTINGS", label: "Settings" },
];
