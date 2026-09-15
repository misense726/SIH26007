import { ThemeToggle } from "../components/ThemeToggle";
import { DashboardViewIcon } from "../layout/DashboardViewIcon";
import type { Theme } from "../theme";
import type { DashboardRole } from "./roleSession";

interface LoginPageProps {
  theme: Theme;
  onThemeChange: (theme: Theme) => void;
  onSelectRole: (role: DashboardRole) => void;
}

export function LoginPage({ theme, onThemeChange, onSelectRole }: LoginPageProps) {
  return (
    <main className="role-login-shell">
      <header className="role-login-header">
        <div className="brand-lockup role-login-brand" aria-label="MI Sense">
          <span className="brand-mark" aria-hidden="true">MI</span>
          <div>
            <p className="eyebrow">Fog-assisted mine operations</p>
            <p className="role-login-product">MI Sense</p>
          </div>
        </div>
        <ThemeToggle theme={theme} onChange={onThemeChange} />
      </header>

      <section className="role-login-stage" aria-labelledby="role-login-title">
        <div className="role-login-intro">
          <h1 id="role-login-title">Choose where you are operating</h1>
        </div>

        <div className="role-login-grid" aria-label="Choose your MI Sense workspace">
          <button
            type="button"
            className="role-choice role-choice-driver"
            onClick={() => onSelectRole("DRIVER")}
          >
            <span className="role-choice-icon"><DashboardViewIcon view="DRIVER" /></span>
            <span className="role-choice-copy">
              <span className="eyebrow role-choice-context">In-cab assistance</span>
              <strong>Driver console</strong>
              <span>Guidance, spatial awareness, and sensor calibration for the active truck.</span>
            </span>
            <span className="role-choice-action">Continue as Driver <span aria-hidden="true">→</span></span>
          </button>

          <button
            type="button"
            className="role-choice role-choice-supervisor"
            onClick={() => onSelectRole("SUPERVISOR")}
          >
            <span className="role-choice-icon"><DashboardViewIcon view="SUPERVISOR" /></span>
            <span className="role-choice-copy">
              <span className="eyebrow role-choice-context">Mine control room</span>
              <strong>Supervisor console</strong>
              <span>Fleet monitoring, truck details, haulage efficiency, and performance oversight.</span>
            </span>
            <span className="role-choice-action">Continue as Supervisor <span aria-hidden="true">→</span></span>
          </button>
        </div>

      </section>
    </main>
  );
}
