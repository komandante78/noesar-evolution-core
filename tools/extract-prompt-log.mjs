// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Build the prompt log NLnet's generative-AI policy requires to accompany an application:
// "the model used, dates/times, prompts themselves, and unedited output"
// (https://nlnet.nl/foundation/policies/generativeAI/).
//
//   node tools/extract-prompt-log.mjs <session.jsonl> [...]  > FUNDING/PROMPT_LOG.md
//   node tools/extract-prompt-log.mjs --self-test
//
// The whole filter is one distinction, and it is the one thing here that can silently break:
// **a tool result is a `user` record too.** Counting those as prompts would inflate this session
// from 20 human prompts to 322 and bury the real ones. `--self-test` pins exactly that.
//
// Tool calls and tool results are excluded because they are neither a prompt nor an output.
// Sidechain records (subagents) are excluded for the same reason — nobody typed them.
//
// WHY A SNAPSHOT IS COMMITTED AS WELL AS THIS SCRIPT: transcripts are not forever. The ones for
// 2026-07-25 and 2026-08-14, which produced 28% of this dossier, no longer exist on any machine
// here. "We can regenerate it later" is precisely the assumption that already failed once.
import { readFileSync } from 'node:fs';

const textOf = (content) => {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content.filter((part) => part.type === 'text').map((part) => part.text).join('\n');
};

const isToolResult = (message) =>
  Array.isArray(message.content) && message.content.some((part) => part.type === 'tool_result');

const isHumanPrompt = (record) =>
  record.type === 'user' && record.message?.role === 'user'
  && !isToolResult(record.message) && !record.isSidechain;

function selfTest() {
  const prompt = { type: 'user', message: { role: 'user', content: [{ type: 'text', text: 'hi' }] } };
  const result = { type: 'user', message: { role: 'user', content: [{ type: 'tool_result', content: 'ok' }] } };
  const sidechain = { type: 'user', isSidechain: true, message: { role: 'user', content: 'sub' } };
  console.assert(isHumanPrompt(prompt), 'a typed message must count as a prompt');
  console.assert(!isHumanPrompt(result), 'a tool result must NOT count as a prompt');
  console.assert(!isHumanPrompt(sidechain), 'a subagent turn must NOT count as a prompt');
  console.assert(textOf([{ type: 'text', text: 'a' }, { type: 'tool_use', name: 'x' }]) === 'a',
    'only text parts are output');
  console.log('self-test ok');
}

if (process.argv[2] === '--self-test') { selfTest(); process.exit(0); }

const files = process.argv.slice(2);
if (files.length === 0) { process.stderr.write('usage: extract-prompt-log.mjs <session.jsonl> [...]\n'); process.exit(2); }

process.stdout.write(`# Prompt log

Generated ${new Date().toISOString()} by \`tools/extract-prompt-log.mjs\`.

What is here, and why exactly this: NLnet's generative-AI policy asks an application to be
accompanied by a log of **the model used, the dates and times, the prompts themselves, and the
unedited output**. Those four things are below, verbatim and in order. Tool calls and their
results are excluded — they are neither a prompt nor an output. Nothing is summarised, shortened
or improved; where an answer was wrong, it is here being wrong.

Scope and the gap it cannot cover: \`FUNDING/20_GENAI_DISCLOSURE.md\`.
`);

for (const file of files) {
  const models = new Set();
  const lines = [];
  let prompts = 0;
  let outputs = 0;

  for (const line of readFileSync(file, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    let record;
    try { record = JSON.parse(line); } catch { continue; }
    const message = record.message;
    if (!message) continue;

    if (isHumanPrompt(record)) {
      const body = textOf(message.content).trim();
      if (!body) continue;
      prompts += 1;
      lines.push(`\n### PROMPT ${prompts} · ${record.timestamp}\n\n${body}\n`);
      continue;
    }
    if (message.role === 'assistant' && !record.isSidechain) {
      if (message.model) models.add(message.model);
      const body = textOf(message.content).trim();
      if (!body) continue;
      outputs += 1;
      lines.push(`\n### OUTPUT ${outputs} · ${record.timestamp} · ${message.model ?? 'model not recorded'}\n\n${body}\n`);
    }
  }

  const name = file.replace(/.*[\\/]/, '').replace(/\.jsonl$/, '');
  process.stdout.write(`\n---\n\n## Session \`${name}\`\n\n`);
  process.stdout.write(`**Models:** ${[...models].join(', ') || 'none recorded'} · `);
  process.stdout.write(`**${prompts} prompts, ${outputs} outputs**\n`);
  process.stdout.write(lines.join(''));
  process.stderr.write(`${name.slice(0, 8)}: ${prompts} prompts, ${outputs} outputs, ${[...models].join(',')}\n`);
}
