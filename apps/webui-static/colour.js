// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Colour arithmetic for the theme layer.
//
// It lives in its own module for one reason: it must be testable without a browser. The
// interface promises a contrast figure while the person is choosing a colour (UI-023) and a
// text variant DERIVED until it reaches 4.5:1 (UI-024). Both are arithmetic, and arithmetic
// asserted by eye is arithmetic nobody checked — an earlier session declared a hue safe on
// the strength of one calculation and had the opposite case wrong.
//
// Every function here is pure. The unit suite exercises them against the WCAG definitions
// and against the reference pairs in docs/WEBUI_DESIGN_V3.md §5.

/** #rgb, #rrggbb or #rrggbbaa -> {r,g,b} 0-255. Returns null for anything else. */
export function parseHex(value) {
  if (typeof value !== 'string') return null;
  const hex = value.trim().replace(/^#/, '');
  if (!/^[0-9a-fA-F]+$/.test(hex)) return null;
  if (hex.length === 3) {
    return { r: parseInt(hex[0] + hex[0], 16), g: parseInt(hex[1] + hex[1], 16), b: parseInt(hex[2] + hex[2], 16) };
  }
  if (hex.length === 6 || hex.length === 8) {
    return { r: parseInt(hex.slice(0, 2), 16), g: parseInt(hex.slice(2, 4), 16), b: parseInt(hex.slice(4, 6), 16) };
  }
  return null;
}

export function toHex({ r, g, b }) {
  const channel = (value) => Math.max(0, Math.min(255, Math.round(value))).toString(16).padStart(2, '0');
  return `#${channel(r)}${channel(g)}${channel(b)}`;
}

/** WCAG 2.x relative luminance. */
export function luminance({ r, g, b }) {
  const channel = (value) => {
    const scaled = value / 255;
    return scaled <= 0.03928 ? scaled / 12.92 : ((scaled + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

/** WCAG 2.x contrast ratio, always >= 1, order-independent. */
export function contrast(a, b) {
  const first = luminance(a);
  const second = luminance(b);
  return (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05);
}

export function rgbToHsl({ r, g, b }) {
  const rn = r / 255; const gn = g / 255; const bn = b / 255;
  const max = Math.max(rn, gn, bn); const min = Math.min(rn, gn, bn);
  const lightness = (max + min) / 2;
  if (max === min) return { h: 0, s: 0, l: lightness };
  const delta = max - min;
  const saturation = lightness > 0.5 ? delta / (2 - max - min) : delta / (max + min);
  let hue;
  if (max === rn) hue = ((gn - bn) / delta + (gn < bn ? 6 : 0)) / 6;
  else if (max === gn) hue = ((bn - rn) / delta + 2) / 6;
  else hue = ((rn - gn) / delta + 4) / 6;
  return { h: hue, s: saturation, l: lightness };
}

export function hslToRgb({ h, s, l }) {
  if (s === 0) return { r: l * 255, g: l * 255, b: l * 255 };
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const channel = (t) => {
    let value = t;
    if (value < 0) value += 1;
    if (value > 1) value -= 1;
    if (value < 1 / 6) return p + (q - p) * 6 * value;
    if (value < 1 / 2) return q;
    if (value < 2 / 3) return p + (q - p) * (2 / 3 - value) * 6;
    return p;
  };
  return { r: channel(h + 1 / 3) * 255, g: channel(h) * 255, b: channel(h - 1 / 3) * 255 };
}

/**
 * The text variant of a chosen hue (UI-024).
 *
 * A hue that does not carry as text is NOT rejected — rejection would tell someone their
 * colour is forbidden, when what is actually true is that this particular pairing is not
 * readable. The hue is kept for fills and indicators, and a readable RELATIVE of it is
 * derived by moving lightness away from the background, one step at a time, until the
 * target ratio is met. Hue and saturation are preserved, so the derived colour is
 * recognisably the colour that was chosen.
 *
 * Returns the derived colour, the ratio it achieves, and whether the original already
 * passed — the interface says which of the two happened rather than silently substituting.
 */
export function deriveReadable(hex, backgroundHex, target = 4.5) {
  const colour = parseHex(hex);
  const background = parseHex(backgroundHex);
  if (!colour || !background) return null;
  const original = contrast(colour, background);
  if (original >= target) {
    return { hex: toHex(colour), ratio: original, derived: false, steps: 0 };
  }
  // Away from the background: lighter on a dark background, darker on a light one.
  const backgroundLuminance = luminance(background);
  const direction = backgroundLuminance < 0.5 ? 1 : -1;
  const { h, s, l } = rgbToHsl(colour);
  let best = { hex: toHex(colour), ratio: original, derived: true, steps: 0 };
  for (let step = 1; step <= 100; step += 1) {
    const lightness = Math.max(0, Math.min(1, l + direction * step * 0.01));
    const candidate = hslToRgb({ h, s, l: lightness });
    const ratio = contrast(candidate, background);
    if (ratio > best.ratio) best = { hex: toHex(candidate), ratio, derived: true, steps: step };
    if (ratio >= target) return { hex: toHex(candidate), ratio, derived: true, steps: step };
    if (lightness === 0 || lightness === 1) break;
  }
  // The ceiling is reachable: pure white on a mid-grey background cannot reach 4.5:1 in
  // either direction. Returning the best attempt with `met:false` is the honest answer —
  // the interface then says the target was not reached instead of implying it was.
  return { ...best, met: false };
}

/** Formats a ratio the way the interface shows it: one decimal, never rounded up to pass. */
export function formatRatio(ratio) {
  return `${(Math.floor(ratio * 10) / 10).toFixed(1)}:1`;
}
