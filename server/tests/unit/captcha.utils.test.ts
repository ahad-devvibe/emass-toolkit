import { describe, expect, it } from "vitest";
import svgCaptcha from "svg-captcha";
import {
  CAPTCHA_BACKGROUND,
  CAPTCHA_GLYPH_COLORS,
  CAPTCHA_NOISE_COLOR,
  restyleCaptchaSvg,
} from "../../src/services/captcha/captcha.utils.js";

describe("restyleCaptchaSvg", () => {
  const raw = svgCaptcha.create({ size: 6, noise: 3, color: false }).data;

  it("adds the brand background as the first element", () => {
    const svg = restyleCaptchaSvg(raw);
    expect(svg).toMatch(
      new RegExp(
        `^<svg[^>]*><rect width="100%" height="100%" fill="${CAPTCHA_BACKGROUND}"/>`,
      ),
    );
  });

  it("colours every glyph from the dark palette and mutes the noise", () => {
    const svg = restyleCaptchaSvg(raw);
    const fills = [...svg.matchAll(/<path fill="(#[0-9A-Fa-f]+)"/g)].map(
      (m) => m[1],
    );
    expect(fills).toHaveLength(6);
    for (const fill of fills) expect(CAPTCHA_GLYPH_COLORS).toContain(fill);

    const strokes = [...svg.matchAll(/stroke="(#[0-9A-Fa-f]+)"/g)].map(
      (m) => m[1],
    );
    expect(strokes.length).toBeGreaterThan(0);
    for (const stroke of strokes) expect(stroke).toBe(CAPTCHA_NOISE_COLOR);
  });
});
