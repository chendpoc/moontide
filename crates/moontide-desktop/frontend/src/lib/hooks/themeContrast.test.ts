import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

interface OklchColor {
  lightness: number;
  chroma: number;
  hue: number;
}

const styles = readFileSync(resolve(process.cwd(), "styles.css"), "utf8");

describe("White and Black theme contrast", () => {
  // Every normal-sized text pairing used by the Chat surface must meet WCAG AA in both explicit
  // themes; the test reads the production CSS tokens so token drift cannot bypass the gate.
  it("keeps normal text pairings at or above 4.5:1", () => {
    for (const selector of [":root", ".dark"]) {
      const tokens = themeTokens(selector);
      for (const [foreground, background] of [
        ["foreground", "background"],
        ["muted-foreground", "background"],
        ["foreground", "message-user"],
        ["foreground", "message-tool"],
        ["muted-foreground", "message-tool"],
        ["sidebar-foreground", "sidebar"],
        ["muted-foreground", "sidebar"],
        ["muted-foreground", "sidebar-accent"],
        ["primary-foreground", "primary"],
        ["destructive", "background"],
        ["destructive", "message-tool"],
        ["destructive", "sidebar"],
        ["warning", "message-tool"],
        ["success", "message-tool"],
      ] as const) {
        expect(
          contrast(tokens[foreground], tokens[background]),
          `${selector} ${foreground} on ${background}`,
        ).toBeGreaterThanOrEqual(4.5);
      }
    }
  });

  // Control boundaries and focus indicators must remain distinguishable at 3:1 in both themes;
  // semantic status borders use these full-strength tokens rather than translucent variants.
  it("keeps control and status boundaries at or above 3:1", () => {
    for (const selector of [":root", ".dark"]) {
      const tokens = themeTokens(selector);
      for (const [foreground, background] of [
        ["border", "background"],
        ["input", "background"],
        ["ring", "background"],
        ["sidebar-border", "sidebar"],
        ["sidebar-ring", "sidebar"],
        ["warning", "message-tool"],
      ] as const) {
        expect(
          contrast(tokens[foreground], tokens[background]),
          `${selector} ${foreground} on ${background}`,
        ).toBeGreaterThanOrEqual(3);
      }
    }
  });
});

function themeTokens(selector: string): Record<string, OklchColor> {
  const start = styles.indexOf(`${selector} {`);
  if (start < 0) {
    throw new Error(`Missing ${selector} theme block`);
  }
  const end = styles.indexOf("\n}", start);
  const block = styles.slice(start, end);
  const tokens: Record<string, OklchColor> = {};
  const tokenPattern = /--([\w-]+):\s*oklch\(([\d.]+)\s+([\d.]+)(?:\s+([\d.]+))?\);/g;
  for (const match of block.matchAll(tokenPattern)) {
    tokens[match[1]] = {
      lightness: Number(match[2]),
      chroma: Number(match[3]),
      hue: Number(match[4] ?? 0),
    };
  }
  return tokens;
}

function contrast(foreground: OklchColor, background: OklchColor): number {
  if (foreground === undefined || background === undefined) {
    throw new Error("Missing contrast token");
  }
  const lighter = Math.max(relativeLuminance(foreground), relativeLuminance(background));
  const darker = Math.min(relativeLuminance(foreground), relativeLuminance(background));
  return (lighter + 0.05) / (darker + 0.05);
}

function relativeLuminance(color: OklchColor): number {
  const radians = (color.hue * Math.PI) / 180;
  const a = color.chroma * Math.cos(radians);
  const b = color.chroma * Math.sin(radians);
  const l = cube(color.lightness + 0.3963377774 * a + 0.2158037573 * b);
  const m = cube(color.lightness - 0.1055613458 * a - 0.0638541728 * b);
  const s = cube(color.lightness - 0.0894841775 * a - 1.291485548 * b);
  const red = clamp(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s);
  const green = clamp(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s);
  const blue = clamp(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s);
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
}

function cube(value: number): number {
  return value * value * value;
}

function clamp(value: number): number {
  return Math.min(1, Math.max(0, value));
}
