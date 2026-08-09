// SPDX-License-Identifier: AGPL-3.0-or-later
//
// When the deterministic resolver could not place an utterance, the model is asked — but only
// ever to CHOOSE, never to interpret.
//
// Owner, s336: *«metti tutto in inglese ma deve esserci anche la traduzione italiana e altre
// lingue, qui dovrebbe aiutare il modello … deve interagire con il modello oppure con ATOM,
// verifica tu la correttezza e dove deve andare»*.
//
// # Where it should go, measured rather than chosen
//
// ATOM's `interpret` was the obvious candidate and it is the wrong one. Driven live against the
// deployed `atomd` on `127.0.0.1:8410`:
//
//     "apri la memoria"           → goal: "Open the memory."                        ✔
//     "sblindarifico quantistico" → goal: "Create a quantum circuit that implements
//                                          the Sblindarifico gate."                 ✖
//
// Two things are wrong there and only one of them is the invention. `interpret` answers a
// different question — what WORK should be done, as a goal with non-goals and success criteria —
// and this needs a destination. And it never declines: the second answer is as confident as the
// first, which is precisely the failure `project_atom_interpret_hallucinates_on_nonsense_input`
// recorded in s320 and which is still true on phi-4. A surface that always answers cannot be put
// in front of something that then ACTS.
//
// # So the model chooses, and the choice is checked
//
// The request is not "what does this mean" but "which of these, or none". The list is the
// product's own entries — the same ones the `/` menu and `voice-intent.js` resolve against — and
// the reply is accepted ONLY if it names one of them. A model that answers with something else,
// with prose, with two names, or with a name it invented, is treated exactly as a model that
// answered NONE.
//
// That is what makes invention harmless HERE while it is dangerous in `interpret`: the output
// space is finite and known before the question is asked, so a wrong answer can only ever be the
// wrong door of the product's own doors, never a door that does not exist. And because the
// caller then re-resolves the chosen NAME through the deterministic resolver, the model never
// authors the line that gets run — it points, and the product writes.
//
// # Why this is where "other languages" is answered
//
// English is the source language of this interface (`i18n-catalog.js`), and Italian is covered
// deterministically because the catalogue has every label. Neither of those extends to a third
// language, and adding one would mean a translator per language for a job the installation
// already has a model for. So: the deterministic path stays first, free and exact; this is the
// fallback that makes any language work without the product carrying a dictionary for it.

/** Why a choice could not be made. Separate values because they send an operator to different
 *  places: nothing configured is a settings problem, an unreachable endpoint is a network one,
 *  and a refusal is the model doing its job. */
export const VoiceChoice = Object.freeze({
  CHOSEN: 'chosen',
  NONE: 'none',
  NOT_CONFIGURED: 'not-configured',
  UNAVAILABLE: 'unavailable',
});

/** The literal the model is told to use when nothing fits. Upper case and unmistakable, so it
 *  cannot be confused with an entry name — no entry in this product is named NONE. */
export const NO_MATCH = 'NONE';

/**
 * The one prompt, built from the list rather than describing it.
 *
 * Deliberately short and deliberately without examples. An example teaches the shape of the
 * answer and also teaches the CONTENT of that example — a demonstration that maps "open the
 * memory" to `memory` makes `memory` more likely for everything, which is a bias nobody would
 * see because the answer is always a plausible entry.
 */
export function choicePrompt(utterance, entries) {
  const catalogue = entries
    .map((entry) => `${entry.name}\t${entry.summary ?? ''}`)
    .join('\n');
  return [
    {
      role: 'system',
      content: [
        'You map one spoken sentence, in any language, to exactly one entry of a fixed list.',
        `Answer with the entry name alone, copied exactly. If none of them is what the speaker asked for, answer ${NO_MATCH}.`,
        'Never explain. Never answer with anything that is not on the list.',
        '',
        'LIST (name<TAB>description):',
        catalogue,
      ].join('\n'),
    },
    { role: 'user', content: String(utterance ?? '') },
  ];
}

/**
 * The model's reply, reduced to a decision.
 *
 * Everything defensive here is because the reply is text from a model and text from a model is
 * the least trustworthy input this product accepts. It is allowed to be verbose, quoted, prefixed
 * with a bullet, or wrapped in backticks — all of that is stripped — but it is NOT allowed to
 * name something that is not on the list. That last check is the whole guarantee, and it is done
 * against the list that was sent rather than against a copy of it.
 */
export function readChoice(reply, entries) {
  const names = new Map(entries.map((entry) => [String(entry.name).toLowerCase(), entry]));
  const firstLine = String(reply ?? '')
    .split('\n')
    .map((line) => line.replace(/^[\s>*-]+/, '').replace(/[`"'.]/g, '').trim())
    .find((line) => line.length > 0) ?? '';
  if (!firstLine) return { kind: VoiceChoice.NONE, reason: 'the model answered nothing' };
  if (firstLine.toUpperCase() === NO_MATCH) return { kind: VoiceChoice.NONE, reason: 'the model found nothing that fits' };
  const entry = names.get(firstLine.toLowerCase());
  if (entry) return { kind: VoiceChoice.CHOSEN, name: entry.name };
  // Reported as NONE rather than as an error, because from the person's side nothing was
  // understood either way — but the reason names what happened, so a model that consistently
  // answers off-list is visible instead of merely looking unhelpful.
  return {
    kind: VoiceChoice.NONE,
    reason: `the model named something this product does not have: ${firstLine.slice(0, 60)}`,
  };
}

/**
 * Ask the configured model to choose. Returns a decision, never a line.
 *
 * `endpoint` is the installation's own model — the same one `NOESAR_AUTHORING_ENDPOINT` names and
 * `/api/v1/models/active` reports. Nothing here reaches outside the installation, which is the
 * property the whole voice stage was built to keep.
 */
export async function chooseDestination({
  utterance, entries = [], endpoint = null, model = null,
  fetchImpl, timeoutMs = 20_000,
} = {}) {
  const said = String(utterance ?? '').trim();
  if (!said) return { kind: VoiceChoice.NONE, reason: 'nothing was said' };
  if (!endpoint) {
    return { kind: VoiceChoice.NOT_CONFIGURED, reason: 'no model is configured, so nothing can be asked to choose' };
  }
  if (!entries.length) return { kind: VoiceChoice.NONE, reason: 'there is nothing to choose from' };
  const impl = fetchImpl ?? (typeof fetch === 'function' ? fetch : null);
  if (typeof impl !== 'function') {
    return { kind: VoiceChoice.UNAVAILABLE, reason: 'no way to reach the model was supplied' };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await impl(`${String(endpoint).replace(/\/+$/, '')}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({
        model: model ?? 'local',
        messages: choicePrompt(said, entries),
        // Zero, and a hard ceiling on length. This is a lookup, not a conversation: sampling
        // would make the same sentence reach two different places on two days, which is the one
        // thing a navigation gesture may never do.
        temperature: 0,
        max_tokens: 24,
        stream: false,
      }),
      signal: controller.signal,
    });
    if (!response?.ok) {
      return { kind: VoiceChoice.UNAVAILABLE, reason: `the model answered ${response?.status ?? 'nothing'}` };
    }
    const body = await response.json();
    return readChoice(body?.choices?.[0]?.message?.content ?? '', entries);
  } catch (error) {
    return {
      kind: VoiceChoice.UNAVAILABLE,
      reason: error?.name === 'AbortError'
        ? `the model did not answer within ${timeoutMs}ms`
        : `the model could not be reached: ${error?.message ?? 'unknown error'}`,
    };
  } finally {
    clearTimeout(timer);
  }
}
