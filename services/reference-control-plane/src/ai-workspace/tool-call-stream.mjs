// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Reassembling a tool call out of a token stream, for each API style this product speaks.
//
// Owner, 2026-08-24: *«la chat non risponde come una vera chat tipo claude o chat gpt»*. The
// largest single difference, measured: Claude and ChatGPT call tools. This product advertised a
// `tools` array to the provider on every turn and then **discarded the answer** —
// `parseSse()` read `choices[0].delta.content` and nothing else, so `delta.tool_calls` never left
// the gateway, and `ToolExecutor` had two callers, neither of them the chat.
//
// # Why this is a module and not four lines inside the parser
//
// A tool call does not arrive whole. Every style fragments it differently, and each fragmentation
// has a different join rule:
//
//   openai-chat        `delta.tool_calls[]`, keyed by `index`; `id` and `function.name` appear
//                      once, on the first fragment, and `function.arguments` arrives as a string
//                      cut at arbitrary character boundaries — mid-token, mid-escape.
//   anthropic-messages `content_block_start` carries `id`/`name`, then `input_json_delta` carries
//                      `partial_json` for the SAME block index, closed by `content_block_stop`.
//   openai-responses   `response.output_item.added` carries the item, then
//                      `response.function_call_arguments.delta` carries argument text keyed by
//                      `output_index`.
//
// Three different keys, three different places the name lives, one shared trap: **the arguments
// are a JSON document delivered as arbitrary string slices**, so nothing may parse them until the
// stream says the call is complete. Concatenate first, parse once, and treat a parse failure as a
// refusal rather than as an empty object — `{}` is a plausible, silent, wrong tool invocation.
//
// Kept separate from `provider-gateway.mjs` so it can be driven by frame fixtures directly,
// without a socket, and so the join rules are one readable table rather than three branches
// buried in a reader loop.

/** How many calls one turn may assemble. A model that emits a thousand of them is a model in a
 *  loop, and the memory that would take is not a cost the person asked for. */
const MAX_CALLS = 32;
/** Arguments longer than this are not a tool call, they are a payload. Bounded here rather than at
 *  execution time so the memory is never allocated in the first place. */
const MAX_ARGUMENT_CHARS = 64 * 1024;

/** Why a reassembled call cannot be run. Separate values because they mean different things to
 *  the person: `malformed` is the model's fault and is worth telling it about so it can retry,
 *  `oversized` is a guard firing. */
export const ToolCallDefect = Object.freeze({
  MALFORMED_ARGUMENTS: 'malformed-arguments',
  OVERSIZED_ARGUMENTS: 'oversized-arguments',
  NO_NAME: 'no-name',
});

function slot(state, key) {
  let value = state.get(key);
  if (!value) {
    if (state.size >= MAX_CALLS) return null;
    value = { id:null, name:null, argumentText:'', truncated:false };
    state.set(key, value);
  }
  return value;
}

function appendArguments(entry, text) {
  if (typeof text !== 'string' || !text) return;
  if (entry.argumentText.length + text.length > MAX_ARGUMENT_CHARS) { entry.truncated = true; return; }
  entry.argumentText += text;
}

/**
 * Observe one decoded SSE event and fold any tool-call fragment it carries into `state`.
 *
 * Returns nothing: this is deliberately a fold, not a filter, because a caller that had to decide
 * "was this a tool frame or a text frame" would be re-implementing the style table it is calling
 * this to avoid. Text extraction stays where it was, in the parser.
 */
export function observeToolCallFrame(style, event, state) {
  if (!event || typeof event !== 'object') return;

  if (style === 'openai-chat') {
    const fragments = event.choices?.[0]?.delta?.tool_calls;
    if (!Array.isArray(fragments)) return;
    for (const fragment of fragments) {
      // `index` is the join key and it is allowed to be 0, so the falsy check a reader reaches for
      // first would drop every first call.
      const key = fragment?.index ?? 0;
      const entry = slot(state, key);
      if (!entry) return;
      if (fragment.id && !entry.id) entry.id = String(fragment.id);
      if (fragment.function?.name && !entry.name) entry.name = String(fragment.function.name);
      appendArguments(entry, fragment.function?.arguments);
    }
    return;
  }

  if (style === 'anthropic-messages') {
    if (event.type === 'content_block_start' && event.content_block?.type === 'tool_use') {
      const entry = slot(state, `block:${event.index ?? 0}`);
      if (!entry) return;
      entry.id = event.content_block.id ? String(event.content_block.id) : entry.id;
      entry.name = event.content_block.name ? String(event.content_block.name) : entry.name;
      return;
    }
    if (event.type === 'content_block_delta' && event.delta?.type === 'input_json_delta') {
      // Only a block already opened as `tool_use` is folded: a text block's deltas share this
      // event type, and treating them as arguments would build a call out of prose.
      const entry = state.get(`block:${event.index ?? 0}`);
      if (entry) appendArguments(entry, event.delta.partial_json);
    }
    return;
  }

  if (style === 'openai-responses') {
    if (event.type === 'response.output_item.added' && event.item?.type === 'function_call') {
      const entry = slot(state, `out:${event.output_index ?? 0}`);
      if (!entry) return;
      entry.id = event.item.call_id ? String(event.item.call_id) : (event.item.id ? String(event.item.id) : entry.id);
      entry.name = event.item.name ? String(event.item.name) : entry.name;
      // Some servers send the whole argument string on the item itself rather than as deltas.
      appendArguments(entry, event.item.arguments);
      return;
    }
    if (event.type === 'response.function_call_arguments.delta') {
      const entry = state.get(`out:${event.output_index ?? 0}`);
      if (entry) appendArguments(entry, event.delta);
    }
  }
}

/**
 * Close the accumulator and return the calls, each either runnable or carrying the reason it is
 * not.
 *
 * A defect is REPORTED, never silently dropped and never silently repaired. A call whose arguments
 * did not parse is the model's mistake, and the loop that receives this is expected to hand that
 * sentence back to the model so it can correct itself — which is what a real assistant does, and
 * is impossible if the failure was quietly turned into `{}`.
 */
export function finishToolCalls(state, { idFor = (index) => `call_${index}` } = {}) {
  const calls = [];
  let index = 0;
  for (const entry of state.values()) {
    const id = entry.id ?? idFor(index);
    index += 1;
    if (!entry.name) { calls.push({ id, name:null, arguments:null, defect:ToolCallDefect.NO_NAME, raw:entry.argumentText }); continue; }
    if (entry.truncated) { calls.push({ id, name:entry.name, arguments:null, defect:ToolCallDefect.OVERSIZED_ARGUMENTS, raw:'' }); continue; }
    const text = entry.argumentText.trim();
    // No arguments at all is legitimate — a tool can take none — and is not the same as arguments
    // that failed to parse.
    if (!text) { calls.push({ id, name:entry.name, arguments:{}, defect:null, raw:'' }); continue; }
    try {
      const parsed = JSON.parse(text);
      if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
        calls.push({ id, name:entry.name, arguments:null, defect:ToolCallDefect.MALFORMED_ARGUMENTS, raw:text });
      } else {
        calls.push({ id, name:entry.name, arguments:parsed, defect:null, raw:text });
      }
    } catch {
      calls.push({ id, name:entry.name, arguments:null, defect:ToolCallDefect.MALFORMED_ARGUMENTS, raw:text });
    }
  }
  return calls;
}

/** A fresh fold state. A `Map` rather than an object so an argument named `__proto__` or
 *  `constructor` — which a model is perfectly capable of emitting — is a key and not a hazard. */
export const newToolCallState = () => new Map();
