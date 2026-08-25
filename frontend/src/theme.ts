export type Theme = "light" | "dark";

export const THEME_STORAGE_KEY = "fogsen-theme";

export function resolveTheme(storedTheme: string | null, prefersDark: boolean): Theme {
  if (storedTheme === "light" || storedTheme === "dark") {
    return storedTheme;
  }
  return prefersDark ? "dark" : "light";
}

export function oppositeTheme(theme: Theme): Theme {
  return theme === "dark" ? "light" : "dark";
}

export function readInitialTheme(): Theme {
  if (typeof window === "undefined") {
    return "dark";
  }

  let storedTheme: string | null = null;
  try {
    storedTheme = window.localStorage.getItem(THEME_STORAGE_KEY);
  } catch {
    // Storage can be unavailable in locked-down browser sessions.
  }

  const prefersDark =
    typeof window.matchMedia === "function"
      ? window.matchMedia("(prefers-color-scheme: dark)").matches
      : true;
  return resolveTheme(storedTheme, prefersDark);
}

export function applyTheme(theme: Theme): void {
  if (typeof document === "undefined") {
    return;
  }

  document.documentElement.dataset.theme = theme;
  document.documentElement.style.colorScheme = theme;
  document
    .querySelector('meta[name="theme-color"]')
    ?.setAttribute("content", theme === "dark" ? "#0a0d12" : "#f4f6f8");
}

export function saveTheme(theme: Theme): void {
  if (typeof window === "undefined") {
    return;
  }

  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, theme);
  } catch {
    // The selected theme still applies for the current session.
  }
}
