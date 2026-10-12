// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Splits the log of tools/capture-screens.mjs (or tools/page-screenshot.mjs) into PNG files, and prints the counters and failures.
//
//   node tools/split-screenshots.mjs <log> <output directory>
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const [logPath, outDir] = process.argv.slice(2);
if (!logPath || !outDir) { console.error('usage: node tools/split-screenshots.mjs <log> <output directory>'); process.exit(2); }

const log = readFileSync(logPath, 'utf8');
mkdirSync(outDir, { recursive: true });
let written = 0;
for (const match of log.matchAll(/===SCREENSHOT ([^\n=]+)===\n([A-Za-z0-9+/=\n]+?)\n===END===/g)) {
  const name = match[1].trim().replace(/[^A-Za-z0-9_.-]+/g, '_');
  writeFileSync(join(outDir, `${name}.png`), Buffer.from(match[2].replace(/\n/g, ''), 'base64'));
  written += 1;
}
console.log(`images written: ${written}`);
for (const line of log.split('\n')) {
  if (/^(FAIL|MESSAGES|BROWSER_E2E_|SCREENSHOT_)/.test(line)) console.log(line.slice(0, 260));
}
process.exit(written > 0 ? 0 : 1);
