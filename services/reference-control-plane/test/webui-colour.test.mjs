// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The colour arithmetic behind the theme layer.
//
// This exists because an earlier session declared a hue safe on the strength of ONE
// calculation — white above the indigo, 6.2:1 — and had the opposite case wrong: the same
// hue AS TEXT on the panel background sits at 2.9:1. A fill and a text colour are two
// different questions, and the interface now derives the second rather than assuming it.
//
// Anchored to the WCAG definitions, not to this implementation's own output.
import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseHex, toHex, luminance, contrast, rgbToHsl, hslToRgb, deriveReadable, formatRatio,
} from '../../../apps/webui-static/colour.js';

const BLACK = { r: 0, g: 0, b: 0 };
const WHITE = { r: 255, g: 255, b: 255 };

describe('colour arithmetic', () => {
  test('parses the three hex forms and rejects anything else', () => {
    assert.deepEqual(parseHex('#fff'), WHITE);
    assert.deepEqual(parseHex('#ffffff'), WHITE);
    assert.deepEqual(parseHex('#ffffffcc'), WHITE);
    assert.deepEqual(parseHex('000000'), BLACK);
    for (const bad of ['', 'rgb(0,0,0)', '#gg0000', '#12345', null, undefined, 42]) {
      assert.equal(parseHex(bad), null, `should reject ${JSON.stringify(bad)}`);
    }
  });

  test('luminance matches the WCAG anchors', () => {
    assert.equal(luminance(BLACK), 0);
    assert.equal(luminance(WHITE), 1);
  });

  test('contrast matches the WCAG anchors and is order-independent', () => {
    assert.equal(Math.round(contrast(BLACK, WHITE) * 100) / 100, 21);
    assert.equal(contrast(WHITE, BLACK), contrast(BLACK, WHITE));
    assert.equal(contrast(WHITE, WHITE), 1);
  });

  // The figures in docs/WEBUI_DESIGN_V3.md §5, recomputed here rather than trusted. If the
  // document and the arithmetic ever disagree, this is where it surfaces.
  test('the reference pairs from the design document hold', () => {
    const panel = '#0c1824';
    const asText = (hex) => contrast(parseHex(hex), parseHex(panel));
    assert.ok(asText('#3958c3') < 3.0, `indigo as text was ${asText('#3958c3')}`);
    assert.ok(asText('#7c56b7') < 3.5, `violet as text was ${asText('#7c56b7')}`);
    assert.ok(asText('#44a259') > 4.5, `green as text was ${asText('#44a259')}`);
    assert.ok(asText('#c5882c') > 4.5, `amber as text was ${asText('#c5882c')}`);
    assert.ok(asText('#34aace') > 4.5, `cyan as text was ${asText('#34aace')}`);
    // White ON the indigo is a different question and passes — the exact confusion that
    // produced the wrong claim.
    assert.ok(contrast(WHITE, parseHex('#3958c3')) > 4.5);
  });

  test('hsl survives a round trip', () => {
    for (const hex of ['#3958c3', '#44a259', '#c5882c', '#34aace', '#7c56b7', '#808080']) {
      const rgb = parseHex(hex);
      const back = hslToRgb(rgbToHsl(rgb));
      assert.equal(toHex(back), hex.toLowerCase(), `round trip failed for ${hex}`);
    }
  });

  test('a hue that already carries as text is returned untouched', () => {
    const result = deriveReadable('#44a259', '#0c1824');
    assert.equal(result.derived, false);
    assert.equal(result.hex, '#44a259');
    assert.ok(result.ratio >= 4.5);
  });

  test('a hue that fails as text is derived, not rejected (UI-024)', () => {
    for (const hex of ['#3958c3', '#7c56b7']) {
      const result = deriveReadable(hex, '#0c1824');
      assert.equal(result.derived, true, `${hex} should have been derived`);
      assert.ok(result.ratio >= 4.5, `${hex} derived to ${result.ratio}`);
      assert.notEqual(result.hex, hex);
      // Recognisably the same colour: hue is preserved, only lightness moved.
      const before = rgbToHsl(parseHex(hex));
      const after = rgbToHsl(parseHex(result.hex));
      assert.ok(Math.abs(before.h - after.h) < 0.02, `hue moved: ${before.h} -> ${after.h}`);
      assert.ok(after.l > before.l, 'on a dark background the variant must be lighter');
    }
  });

  test('on a LIGHT background the variant moves the other way', () => {
    const result = deriveReadable('#ffd489', '#ffffff');
    assert.equal(result.derived, true);
    const before = rgbToHsl(parseHex('#ffd489'));
    const after = rgbToHsl(parseHex(result.hex));
    assert.ok(after.l < before.l, 'on a light background the variant must be darker');
    assert.ok(result.ratio >= 4.5, `reached only ${result.ratio}`);
  });

  test('an unreachable target is reported, not faked', () => {
    // Mid grey: nothing of this hue reaches 4.5:1 in either direction.
    const result = deriveReadable('#808080', '#808080');
    assert.ok(result.ratio < 4.5);
    assert.equal(result.met, false, 'an unreachable target must say so');
  });

  test('every hue of the wheel is either fine or made fine on the default background', () => {
    // The picker accepts ANY hue (UI-022), so the derivation is exercised across the wheel
    // rather than on the two colours that happened to be in the design document.
    const failures = [];
    for (let hue = 0; hue < 360; hue += 5) {
      const rgb = hslToRgb({ h: hue / 360, s: 0.62, l: 0.5 });
      const result = deriveReadable(toHex(rgb), '#0c1824');
      if (result.ratio < 4.5) failures.push({ hue, ratio: result.ratio, hex: result.hex });
    }
    assert.deepEqual(failures, [], `hues that could not be made readable: ${JSON.stringify(failures.slice(0, 4))}`);
  });

  test('the ratio is never rounded up into a pass', () => {
    assert.equal(formatRatio(4.49), '4.4:1');
    assert.equal(formatRatio(4.5), '4.5:1');
    assert.equal(formatRatio(21), '21.0:1');
  });
});
