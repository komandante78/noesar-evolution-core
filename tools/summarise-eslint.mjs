// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Turn an ESLint JSON report into a summary a human reads and a gate can act on.
//
//   node tools/summarise-eslint.mjs <report.json> [--max-lines N]
//
// Exits non-zero if the report contains at least one error, so this is usable as the
// gate step directly.

import fs from 'node:fs';

const [, , reportPath, ...rest] = process.argv;
if (!reportPath) {
  process.stderr.write('usage: summarise-eslint.mjs <report.json>\n');
  process.exit(2);
}

const maxLinesIndex = rest.indexOf('--max-lines');
const maxLines = maxLinesIndex >= 0 ? Number(rest[maxLinesIndex + 1]) : 60;

const report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));

let errors = 0;
let warnings = 0;
const byRule = new Map();
const lines = [];

for (const file of report) {
  errors += file.errorCount ?? 0;
  warnings += file.warningCount ?? 0;
  for (const message of file.messages ?? []) {
    const rule = message.ruleId ?? '(parse error)';
    byRule.set(rule, (byRule.get(rule) ?? 0) + 1);
    if (message.severity === 2) {
      lines.push(
        `${file.filePath.replace(/^\/src\//, '')}:${message.line}:${message.column}  ${rule}  ${message.message}`,
      );
    }
  }
}

const ranked = [...byRule.entries()].sort((a, b) => b[1] - a[1]);

process.stdout.write(`ESLINT_FILES=${report.length}\n`);
process.stdout.write(`ESLINT_ERRORS=${errors}\n`);
process.stdout.write(`ESLINT_WARNINGS=${warnings}\n`);
// no-undef is called out separately because it is the rule this whole gate exists for.
process.stdout.write(`ESLINT_NO_UNDEF=${byRule.get('no-undef') ?? 0}\n`);
if (ranked.length) {
  process.stdout.write('\nby rule:\n');
  for (const [rule, count] of ranked) process.stdout.write(`  ${String(count).padStart(5)}  ${rule}\n`);
}
if (lines.length) {
  process.stdout.write('\nerrors:\n');
  for (const line of lines.slice(0, maxLines)) process.stdout.write(`  ${line}\n`);
  if (lines.length > maxLines) {
    process.stdout.write(`  … and ${lines.length - maxLines} more (raise --max-lines to see them)\n`);
  }
}

process.exit(errors > 0 ? 1 : 0);
