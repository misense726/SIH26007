import { dashboardRoleFromHash } from "../layout/dashboardViews";

export type DashboardRole = "DRIVER" | "SUPERVISOR";

export const ROLE_SESSION_KEY = "fogsen-dashboard-role";

export function parseDashboardRole(value: string | null): DashboardRole | null {
  return value === "DRIVER" || value === "SUPERVISOR" ? value : null;
}

export function readInitialRole(): DashboardRole | null {
  if (typeof window === "undefined") {
    return null;
  }

  const linkedRole = dashboardRoleFromHash(window.location?.hash ?? "");
  if (linkedRole) {
    return linkedRole;
  }

  try {
    return parseDashboardRole(window.sessionStorage.getItem(ROLE_SESSION_KEY));
  } catch {
    return null;
  }
}

export function saveRole(role: DashboardRole): void {
  if (typeof window === "undefined") {
    return;
  }

  try {
    window.sessionStorage.setItem(ROLE_SESSION_KEY, role);
  } catch {
    // The in-memory selection remains active when storage is unavailable.
  }
}

export function clearRole(): void {
  if (typeof window === "undefined") {
    return;
  }

  try {
    window.sessionStorage.removeItem(ROLE_SESSION_KEY);
  } catch {
    // Logout still clears the in-memory role when storage is unavailable.
  }
}
