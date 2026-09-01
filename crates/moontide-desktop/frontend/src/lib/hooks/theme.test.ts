import "@testing-library/jest-dom/vitest";

import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  THEME_STORAGE_KEY,
  initializeThemePreference,
  resolveInitialTheme,
  setThemePreference,
  type ThemeEnvironment,
} from "./theme.js";

describe("theme preference", () => {
  beforeEach(() => {
    document.documentElement.className = "";
    document.documentElement.removeAttribute("data-theme");
    document.documentElement.style.colorScheme = "";
  });

  it("uses an explicit persisted preference before the system preference", () => {
    const environment = themeEnvironment("white", true);

    expect(resolveInitialTheme(environment)).toBe("white");
  });

  it("uses the system preference when storage has no valid explicit value", () => {
    expect(resolveInitialTheme(themeEnvironment(null, true))).toBe("black");
    expect(resolveInitialTheme(themeEnvironment("system", false))).toBe("white");
  });

  it("initializes the document without persisting a system-derived preference", () => {
    const environment = themeEnvironment(null, true);

    expect(initializeThemePreference(environment)).toBe("black");
    expect(document.documentElement).toHaveClass("dark");
    expect(document.documentElement).toHaveAttribute("data-theme", "black");
    expect(document.documentElement.style.colorScheme).toBe("dark");
    expect(environment.storage.setItem).not.toHaveBeenCalled();
  });

  it("persists only explicit white or black selections and applies them immediately", () => {
    const environment = themeEnvironment(null, false);

    setThemePreference("black", environment);
    expect(environment.storage.setItem).toHaveBeenLastCalledWith(
      THEME_STORAGE_KEY,
      "black",
    );
    expect(document.documentElement).toHaveClass("dark");

    setThemePreference("white", environment);
    expect(environment.storage.setItem).toHaveBeenLastCalledWith(
      THEME_STORAGE_KEY,
      "white",
    );
    expect(document.documentElement).not.toHaveClass("dark");
    expect(document.documentElement).toHaveAttribute("data-theme", "white");
    expect(document.documentElement.style.colorScheme).toBe("light");
  });

  it("keeps an explicit selection active when browser storage cannot persist it", () => {
    const environment = themeEnvironment(null, false);
    vi.mocked(environment.storage.setItem).mockImplementation(() => {
      throw new Error("storage unavailable");
    });

    expect(() => setThemePreference("black", environment)).not.toThrow();
    expect(document.documentElement).toHaveClass("dark");
    expect(document.documentElement).toHaveAttribute("data-theme", "black");
  });
});

function themeEnvironment(stored: string | null, systemDark: boolean): ThemeEnvironment {
  return {
    root: document.documentElement,
    storage: {
      getItem: vi.fn(() => stored),
      setItem: vi.fn(),
    },
    matchMedia: vi.fn(() => ({ matches: systemDark })),
  };
}
