// SPDX-License-Identifier: AGPL-3.0-or-later
//
// §4#9 (D-0645/D-0648): "if I write to create an agent, it should create it — I don't want
// the hassle." The model already answers in prose; this is the one, narrow, tagged channel
// by which that prose can become a real `AgentService.createAgent()` call, with no new
// execution surface and no confirmation step — the same zero-confirmation posture the
// Agents form has always had for this exact action.
//
// The shape is deliberately the one `author.mjs` already established for the same problem
// (`extractBody`: a fenced block or nothing, never a guess) — ONE tagged fence, valid JSON,
// a non-empty name, or the directive is simply absent. There is no partial match and no
// best-effort parse: an ambiguous or malformed block is treated exactly like no block at
// all, so the model asking a clarifying question in prose (the D-0123 posture voice-intent.js
// already applies to speech) is always the safe fallback, never a half-created agent.
//
// What this does NOT do: bind tools. `toolIds` from chat is a stated extension point
// (`D-0648`), not built — keeping the first slice to name+instructions is what keeps this
// module's surface small enough to read in one sitting.

const FENCE = /```agent-create\s*\n([\s\S]*?)\n```/g;
const MAX_NAME = 200;
const MAX_INSTRUCTIONS = 4000;

/**
 * The instruction appended to every chat system prompt, so the bound model — whichever one
 * is active — knows the channel exists. Deliberately conditional: it tells the model to use
 * the fence ONLY when the request is unambiguous, and to ask instead when it is not, mirroring
 * the same instruction this product already gives ACT mode about mutative tools.
 */
export const AGENT_DIRECTIVE_INSTRUCTION =
  'If, and only if, the user unambiguously asks you to create a reusable assistant agent ' +
  '(a named persona with its own standing instructions) — for example "create an agent that ' +
  'reviews PRs and is concise" — emit exactly one fenced block tagged agent-create, containing ' +
  'JSON with "name" and "instructions" keys, in addition to a short confirmation sentence. ' +
  'Example:\n```agent-create\n{"name":"Release Reviewer","instructions":"Review release notes. ' +
  'Be concrete, name files, and say plainly what you cannot verify."}\n```\n' +
  'If the request is ambiguous — the name or the instructions are unclear — do not emit the ' +
  'block; ask a clarifying question instead. Never emit more than one such block in one reply.';

/**
 * Pulls an agent-creation directive out of a completed assistant answer.
 *
 * Returns `{ cleanedText, directive }`. `directive` is `null` whenever the fence is absent,
 * duplicated, malformed JSON, or missing a usable name — every one of those is the same
 * outcome as the model choosing not to emit it, by design (see module header).
 */
export function extractAgentDirective(answer) {
  const text = String(answer ?? '');
  const fences = [...text.matchAll(FENCE)];
  if (fences.length !== 1) return { cleanedText: text, directive: null };
  let parsed;
  try {
    parsed = JSON.parse(fences[0][1]);
  } catch {
    return { cleanedText: text, directive: null };
  }
  const name = String(parsed?.name ?? '').trim().slice(0, MAX_NAME);
  if (!name) return { cleanedText: text, directive: null };
  const instructions = String(parsed?.instructions ?? '').trim().slice(0, MAX_INSTRUCTIONS);
  const cleanedText = text.slice(0, fences[0].index) + text.slice(fences[0].index + fences[0][0].length);
  return { cleanedText: cleanedText.trim(), directive: { name, instructions } };
}
