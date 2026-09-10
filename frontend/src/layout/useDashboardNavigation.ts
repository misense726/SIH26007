import { useCallback, useEffect, useState } from "react";
import type { DashboardRole } from "../auth/roleSession";
import {
  dashboardViewLabel,
  defaultDashboardView,
  resolveDashboardRoute,
  type DashboardView,
} from "./dashboardViews";

function currentDashboardView(role: DashboardRole): DashboardView {
  return typeof window === "undefined"
    ? defaultDashboardView(role)
    : resolveDashboardRoute(role, window.location.hash).view;
}

function normalizeLocation(role: DashboardRole): DashboardView {
  const route = resolveDashboardRoute(role, window.location.hash);
  if (window.location.hash !== route.hash) {
    window.history.replaceState(null, "", route.hash);
  }
  return route.view;
}

export function useDashboardNavigation(role: DashboardRole): {
  view: DashboardView;
  navigate: (view: DashboardView) => void;
} {
  const [view, setView] = useState<DashboardView>(() => currentDashboardView(role));

  useEffect(() => {
    const syncFromLocation = () => setView(normalizeLocation(role));
    syncFromLocation();
    window.addEventListener("hashchange", syncFromLocation);
    window.addEventListener("popstate", syncFromLocation);
    return () => {
      window.removeEventListener("hashchange", syncFromLocation);
      window.removeEventListener("popstate", syncFromLocation);
    };
  }, [role]);

  useEffect(() => {
    document.title = `${dashboardViewLabel(view)} | FogSen`;
  }, [view]);

  const navigate = useCallback((requestedView: DashboardView) => {
    const route = resolveDashboardRoute(role, requestedView);
    if (window.location.hash !== route.hash) {
      window.history.pushState(null, "", route.hash);
    }
    setView(route.view);
  }, [role]);

  return { view, navigate };
}
