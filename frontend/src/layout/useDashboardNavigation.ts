import { useCallback, useEffect, useState } from "react";
import {
  dashboardViewFromHash,
  dashboardViewHash,
  dashboardViewLabel,
  type DashboardView,
} from "./dashboardViews";

function currentDashboardView(): DashboardView {
  return typeof window === "undefined" ? "DRIVER" : dashboardViewFromHash(window.location.hash);
}

export function useDashboardNavigation(): {
  view: DashboardView;
  navigate: (view: DashboardView) => void;
} {
  const [view, setView] = useState<DashboardView>(currentDashboardView);

  useEffect(() => {
    const syncFromLocation = () => setView(currentDashboardView());
    window.addEventListener("hashchange", syncFromLocation);
    window.addEventListener("popstate", syncFromLocation);
    return () => {
      window.removeEventListener("hashchange", syncFromLocation);
      window.removeEventListener("popstate", syncFromLocation);
    };
  }, []);

  useEffect(() => {
    document.title = `${dashboardViewLabel(view)} | FogSen`;
  }, [view]);

  const navigate = useCallback((nextView: DashboardView) => {
    const nextHash = dashboardViewHash(nextView);
    if (window.location.hash !== nextHash) {
      window.history.pushState(null, "", nextHash);
    }
    setView(nextView);
  }, []);

  return { view, navigate };
}
