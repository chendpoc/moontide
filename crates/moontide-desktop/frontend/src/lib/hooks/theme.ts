export const THEME_STORAGE_KEY = "moontide.theme";

export type ThemePreference = "white" | "black";

type ThemeStorage = Pick<Storage, "getItem" | "setItem">;
type ThemeMediaQuery = Pick<MediaQueryList, "matches">;
type ThemeRoot = Pick<HTMLElement, "classList" | "dataset" | "style">;

export interface ThemeEnvironment {
  root: ThemeRoot;
  storage: ThemeStorage;
  matchMedia: (query: string) => ThemeMediaQuery;
}

export function isThemePreference(value: unknown): value is ThemePreference {
  return value === "white" || value === "black";
}

export function resolveInitialTheme(
  environment: Pick<ThemeEnvironment, "storage" | "matchMedia">,
): ThemePreference {
  let stored: string | null = null;
  try {
    stored = environment.storage.getItem(THEME_STORAGE_KEY);
  } catch {
    // Browser storage can be unavailable while system preference remains usable.
  }

  if (isThemePreference(stored)) {
    return stored;
  }

  return environment.matchMedia("(prefers-color-scheme: dark)").matches
    ? "black"
    : "white";
}

export function applyThemePreference(theme: ThemePreference, root: ThemeRoot): void {
  root.classList.toggle("dark", theme === "black");
  root.dataset.theme = theme;
  root.style.colorScheme = theme === "black" ? "dark" : "light";
}

export function initializeThemePreference(
  environment: ThemeEnvironment = browserThemeEnvironment(),
): ThemePreference {
  const theme = resolveInitialTheme(environment);
  applyThemePreference(theme, environment.root);
  return theme;
}

export function setThemePreference(
  theme: ThemePreference,
  environment: ThemeEnvironment = browserThemeEnvironment(),
): void {
  applyThemePreference(theme, environment.root);
  try {
    environment.storage.setItem(THEME_STORAGE_KEY, theme);
  } catch {
    // Keep the explicit choice active for this window when persistence is unavailable.
  }
}

function browserThemeEnvironment(): ThemeEnvironment {
  return {
    root: document.documentElement,
    storage: window.localStorage,
    matchMedia: window.matchMedia.bind(window),
  };
}
