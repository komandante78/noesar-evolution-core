// SPDX-License-Identifier: AGPL-3.0-or-later
//
// F-UI-001 recorded that the product's own Content-Security-Policy blocks the styling of its
// own default-password banner, and closed with: "A check that no innerHTML in
// apps/webui-static carries a style attribute would close the class, and does not exist."
// This is that check.
//
// The policy this defends is MAIN_CSP's `style-src 'self'`, which refuses any style attribute
// PARSED FROM MARKUP. It does not refuse the CSSOM: `element.style.cssText = ...` and
// `element.style.height = ...` are how the same files style the same elements and are not
// blocked. So the rule is narrow and mechanical -- a style attribute inside a string that
// becomes markup is a defect; a property set on an element object is not -- and the regex
// below is written to tell those two apart rather than to ban the word `style`.
//
// Measured 2026-09-20 when this file was written: two violations existed, the banner link
// named in F-UI-001 and a second one nobody had recorded, the `<i style="height:N%">` bars of
// the review-time sparkline, which had therefore been rendering at the stylesheet's height
// instead of their own. A defect found by a check on the day the check is written is the
// argument for the check.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const WEBUI = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'apps', 'webui-static');

// A style attribute in markup: `style` preceded by whitespace (so `.style.cssText` and
// `el.style.height` are not it) and followed by `=` and an opening quote.
const MARKUP_STYLE_ATTRIBUTE = /\sstyle\s*=\s*["'`]/;

function sourcesToCheck() {
  return readdirSync(WEBUI, { withFileTypes: true })
    // `vendor/` is third-party and is not ours to rewrite; it is also not where the product
    // builds its own markup. Everything else in this directory is first-party.
    .filter((entry) => entry.isFile() && /\.(js|html)$/.test(entry.name))
    .map((entry) => entry.name)
    .sort();
}

test('no first-party web UI source builds markup carrying a style attribute', () => {
  const files = sourcesToCheck();
  assert.ok(files.length >= 5, `expected to find the web UI sources, found ${files.length}`);

  const offenders = [];
  for (const name of files) {
    const text = readFileSync(join(WEBUI, name), 'utf8');
    text.split('\n').forEach((line, index) => {
      if (MARKUP_STYLE_ATTRIBUTE.test(line)) offenders.push(`${name}:${index + 1}`);
    });
  }

  assert.deepEqual(
    offenders,
    [],
    'MAIN_CSP style-src \'self\' refuses a style attribute parsed from markup, so these render '
      + 'unstyled in a real browser while every test that never opens one stays green. Set the '
      + 'property through the CSSOM instead (element.style.cssText / element.style.height), '
      + 'which the policy allows and which these same files already use: ' + offenders.join(', ')
  );
});

test('the check can go red: a style attribute in markup is recognised, a CSSOM write is not', () => {
  // The oracle. Without this, a regex that matched nothing would pass the test above forever
  // and the guarantee would be a comment rather than a control.
  assert.ok(MARKUP_STYLE_ATTRIBUTE.test(`<a href="#settings" style="color:#fff;">x</a>`));
  assert.ok(MARKUP_STYLE_ATTRIBUTE.test(`<i style='height:4%'></i>`));
  assert.ok(!MARKUP_STYLE_ATTRIBUTE.test(`banner.style.cssText='color:#fff';`));
  assert.ok(!MARKUP_STYLE_ATTRIBUTE.test(`bar.style.height = '4%';`));
  assert.ok(!MARKUP_STYLE_ATTRIBUTE.test(`<i data-height="4"></i>`));
});
