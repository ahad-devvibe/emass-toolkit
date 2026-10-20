// Brand-toned captcha styling: dark, high-contrast glyphs on a soft tint with
// muted noise lines, instead of svg-captcha's saturated random colours.
export const CAPTCHA_BACKGROUND = "#EEF4FB";
export const CAPTCHA_GLYPH_COLORS = [
  "#0F3678",
  "#123E73",
  "#1F2F4D",
  "#0B4F8A",
];
export const CAPTCHA_NOISE_COLOR = "#8FA6C4";

/**
 * Restyles an svg-captcha SVG generated with `color: false` and no
 * background: glyphs are `<path fill=…>`, noise lines are `<path stroke=…>`.
 */
export function restyleCaptchaSvg(
  svg: string,
  random: () => number = Math.random,
): string {
  // Recolour first, then add the background, so the rect keeps its own fill
  return svg
    .replace(/fill="#[0-9a-fA-F]{3,6}"/g, () => {
      const color =
        CAPTCHA_GLYPH_COLORS[
          Math.floor(random() * CAPTCHA_GLYPH_COLORS.length)
        ];
      return `fill="${color}"`;
    })
    .replace(
      /stroke="#[0-9a-fA-F]{3,6}"/g,
      `stroke="${CAPTCHA_NOISE_COLOR}" stroke-width="1.5"`,
    )
    .replace(
      /(<svg[^>]*>)/,
      `$1<rect width="100%" height="100%" fill="${CAPTCHA_BACKGROUND}"/>`,
    );
}
