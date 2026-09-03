import type { DashboardView } from "./dashboardViews";

export function DashboardViewIcon({ view }: { view: DashboardView }) {
  if (view === "DRIVER") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M4 16.5V9.8c0-.8.4-1.5 1.1-1.9L8 6.2h8l2.9 1.7c.7.4 1.1 1.1 1.1 1.9v6.7" />
        <path d="M6 13h12M7.5 16.5h.01M16.5 16.5h.01M7 6.2l1.2-2.2h7.6L17 6.2M5 19h3v-2.5M19 19h-3v-2.5" />
      </svg>
    );
  }

  if (view === "SPATIAL") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <circle cx="12" cy="12" r="2.3" />
        <circle cx="12" cy="12" r="6" />
        <path d="M12 2v2M12 20v2M2 12h2M20 12h2" />
      </svg>
    );
  }

  if (view === "SUPERVISOR") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <rect x="3" y="5" width="8" height="6" rx="1.5" />
        <rect x="13" y="13" width="8" height="6" rx="1.5" />
        <path d="M11 8h3a3 3 0 0 1 3 3v2M7 11v3a3 3 0 0 0 3 3h3" />
      </svg>
    );
  }

  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M4 6h8M16 6h4M4 12h3M11 12h9M4 18h10M18 18h2" />
      <circle cx="14" cy="6" r="2" />
      <circle cx="9" cy="12" r="2" />
      <circle cx="16" cy="18" r="2" />
    </svg>
  );
}
