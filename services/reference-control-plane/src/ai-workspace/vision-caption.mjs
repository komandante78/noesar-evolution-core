// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The image-caption fallback — `D-0649`/`D-0651`, `§4#10` item 2.
//
// # The gap this closes
//
// `file-extractors.mjs`'s image branch only ever ran `tesseract-ocr` — text PRINTED IN the
// image. A photograph with no printed text extracted nothing and was reported `complete` with
// empty text, indistinguishable from an image that genuinely had none. This file is the second
// attempt `file-extractors.mjs` reaches for when OCR finds nothing: describe the image with a
// vision-capable model, and store the description as the extracted text — same shape as every
// other extractor, so the RAG pipeline (`knowledgeContext()`, `hybridSearch`) needs no change.
//
// # The concept that did not exist before this file: how a provider declares "I accept images"
//
// `model-catalog.mjs` already has a `vision` value in its `TYPES` vocabulary — but that catalogue
// describes the LOCAL model RUNTIME's downloadable artefacts, never a configured chat provider
// profile (`provider-gateway.mjs`), and nothing anywhere read that value. A provider profile
// (local or remote) has no field at all for "this model understands images" until this phase.
// `visionCapable` on the profile (`provider-gateway.mjs` `create()`/`update()`) is that field —
// declared by the operator, never probed, the same posture already held for `contextWindow`: no
// provider style here reports its own multimodal ability, so guessing it from a model id would be
// a fact-shaped guess, the exact thing `model-catalog.mjs`'s own module comment refuses to do.
//
// # Why only two of the three `apiStyle`s
//
// `provider-gateway.mjs` already speaks `openai-chat`, `openai-responses` and
// `anthropic-messages` for TEXT, but `#request()`'s `mapOpenAiMessages()` passes `content`
// through unchanged — nothing in this product has ever sent multipart content before, so no
// wire shape for an image content part has been exercised. `openai-chat`'s `image_url` part and
// `anthropic-messages`'s base64 `image` source part are the two well-established, high-confidence
// shapes; the Responses API's own multimodal input shape (`input_image`/`input_text`) is a
// DIFFERENT, less-travelled contract this product has never sent either half of. Guessing it
// here — unverifiable without a live account — would be exactly the fabricated-shape risk
// `CLAUDE10.md` rule 40 exists to refuse. A profile of type `openai` (the only `openai-responses`
// entry in `DEFAULT_CATALOG`) is therefore correctly refused for captioning today, declared as
// such, not silently miscoded. Extending to `openai-responses` is a small, separate, verifiable
// follow-up once its shape can be checked against a live response.
//
// # What this file never does
//
// It never falls back to OCR pretending to be a caption, and never invents a caption when no
// vision-capable provider is configured or reachable — the same "report the gap honestly" posture
// `voice-engine.mjs` holds for transcription (`D-0650`), and the same reason: a silent invention
// shown as if it were read from the image is a worse failure than an empty result with a reason.

export const SUPPORTED_VISION_STYLES = Object.freeze(['openai-chat', 'anthropic-messages']);

export const CAPTION_PROMPT = 'Describe this image factually and thoroughly: any visible text '
  + '(transcribe it exactly), objects, people, charts, diagrams, and what they show. This '
  + 'description becomes the searchable text for this file — be complete, not brief.';

/**
 * Which of the operator's provider profiles may be asked to caption an image, in priority order.
 *
 * `enabled` and `visionCapable` are both required: a provider disabled for chat is not silently
 * re-enabled for captioning, and a provider the operator never declared vision-capable is never
 * guessed into one because its `apiStyle` happens to support the wire shape.
 */
export function visionCapableProfiles(profiles = []) {
  return (profiles ?? [])
    .filter((profile) => profile?.enabled && profile?.visionCapable && SUPPORTED_VISION_STYLES.includes(profile?.apiStyle))
    .sort((a, b) => (a.priority ?? 100) - (b.priority ?? 100));
}

/** The multipart content this profile's `apiStyle` needs to carry an image, in its own shape. */
export function visionContentFor(apiStyle, { text, base64, mimeType }) {
  if (apiStyle === 'anthropic-messages') {
    return [
      { type: 'text', text },
      { type: 'image', source: { type: 'base64', media_type: mimeType, data: base64 } },
    ];
  }
  // openai-chat, and any custom-openai-compatible profile declaring that style — the OpenAI
  // Chat Completions vision shape, which `custom-openai-compatible` servers speaking that API
  // (llava/qwen-vl servers included) already implement the same way.
  return [
    { type: 'text', text },
    { type: 'image_url', image_url: { url: `data:${mimeType};base64,${base64}` } },
  ];
}

/**
 * Describe an image with the first reachable vision-capable provider, trying each in priority
 * order — the same fallback shape `ProviderGateway#completeWithFallback` already holds for chat.
 *
 * `complete` is `(profileId, request) => Promise<{text}>` — injected rather than a `ProviderGateway`
 * instance, so this is provable against a fake without a store, a vault or a real HTTP call. In
 * production it is `providerGateway.complete.bind(providerGateway)` (`server.mjs`).
 *
 * Never throws: a caption attempt is a fallback for an extractor that already has a metadata
 * result to return. A provider outage must not fail the whole upload.
 */
export async function captionImage({ profiles = [], complete, bytes, mimeType, prompt = CAPTION_PROMPT, maxOutputTokens = 700 } = {}) {
  const candidates = visionCapableProfiles(profiles);
  if (!candidates.length) {
    return { configured: false, text: '', reason: 'no enabled provider is declared vision-capable (Settings → Providers)' };
  }
  if (typeof complete !== 'function') {
    return { configured: false, text: '', reason: 'no way to reach a provider was supplied' };
  }
  const base64 = Buffer.isBuffer(bytes) ? bytes.toString('base64') : Buffer.from(bytes ?? []).toString('base64');
  const failures = [];
  for (const profile of candidates) {
    try {
      const content = visionContentFor(profile.apiStyle, { text: prompt, base64, mimeType });
      const result = await complete(profile.id, { model: profile.defaultModel, messages: [{ role: 'user', content }], maxOutputTokens });
      const text = String(result?.text ?? '').trim();
      if (!text) { failures.push({ providerId: profile.id, error: 'the provider returned no caption text' }); continue; }
      return { configured: true, text, model: profile.defaultModel ?? null, providerId: profile.id, failures };
    } catch (error) {
      failures.push({ providerId: profile.id, error: error?.message ?? String(error) });
    }
  }
  return { configured: true, text: '', failed: true, failures };
}
