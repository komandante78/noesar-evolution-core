// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The system message the assistant actually gets, composed from THIS installation's live state.
//
// Owner, 2026-08-24: *«la chat non risponde come una vera chat tipo claude o chat gpt»*.
//
// # What was wrong, measured rather than guessed
//
// Until this file existed the entire system message was `instructionForMode()` — three sentences
// naming ASK/CREATE/ACT and nothing else. Nothing told the model what product it was inside, what
// the installation could do, or who it was talking to. The live message log showed the result
// exactly: asked *"PERCHE NON FUNZIONI?"*, the assistant answered with a generic tutorial on
// software-debugging methodology. That is the correct answer for a model that does not know it is
// anything in particular, which is precisely what it was.
//
// A chat "like Claude or ChatGPT" is not a bigger model with the same empty prompt. It is an
// assistant that knows what it is, knows what it is attached to, and answers *that* rather than
// answering the general case. This file is the first half of that; the tool-call loop is the
// second.
//
// # Two rules this file will not break
//
// **Everything here is derived from live state, never asserted.** A capability that is not
// configured is not mentioned, and where it is relevant it is named as absent. Telling a person
// the product can speak when no speech endpoint is set is the same class of lie as a false PASS
// (`CLAUDE10.md` rule 38) — and a model told it has a tool it does not have will promise to use
// it.
//
// **Nothing untrusted goes in the system message.** Source names come from uploaded documents, so
// a filename is third-party text; `untrusted-content.mjs` already exists because that boundary
// matters. Sources are therefore counted here, never named. Tool and project names are authored
// by the operator, so they are admitted — bounded and flattened, because "operator-authored" is a
// statement about intent, not about shape.

/** Names are operator-authored, not free text from a document — but a name is still allowed to
 *  contain a newline, and a newline in a system message is a section boundary. Flatten and bound
 *  every one of them: a label is a label, and 80 characters is more than a label needs. */
function label(value, max = 80) {
  const flat = String(value ?? '').replace(/\s+/g, ' ').trim();
  if (!flat) return '';
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

/** How many of a list to name before switching to a count. Naming 200 tools would spend the
 *  context the answer needs on an inventory nobody asked for. */
const NAME_LIMIT = 24;

function namedList(items, mapper) {
  const named = items.slice(0, NAME_LIMIT).map(mapper).filter(Boolean);
  const rest = items.length - named.length;
  return rest > 0 ? `${named.join(', ')}, and ${rest} more` : named.join(', ');
}

/**
 * The three modes, unchanged in meaning from what they always said — but the citation sentence is
 * now conditional.
 *
 * **This was a real defect, not a refactor.** The instruction to cite `[source:<id>#<passage>]`
 * was emitted on every turn, including the turns where zero passages were retrieved — which is
 * every turn on an installation with no sources, and the live one has none. A small model told to
 * cite evidence it was never given does not ignore the instruction; it answers in the register the
 * instruction implies. Part of the "tutorial bot" voice was this sentence.
 */
export function instructionForMode(mode, { hasEvidence = false } = {}) {
  const cite = hasEvidence
    ? ' Cite retrieved passages using their exact [source:<id>#<passage>] labels, and never present retrieval as independent fact verification.'
    : '';
  if (mode === 'CREATE') return `CREATE mode: produce a concrete, editable artifact rather than describing one. State your assumptions.${cite}`;
  if (mode === 'ACT') return `ACT mode: plan before acting, and never run a mutative tool without an explicit approval token. Report each step and its real result.${cite}`;
  return `ASK mode: answer precisely, and keep what you were given, what was retrieved, and what you are unsure of distinguishable.${cite}`;
}

/**
 * What this installation is, right now.
 *
 * Every field is a measurement passed in by the caller. This function invents nothing and reaches
 * nothing — it is pure so that its output can be pinned by a test, which is the only way a claim
 * about honesty is worth anything.
 */
export function describeInstallation(snapshot = {}) {
  const {
    productName = 'NOESAR Evolution',
    edition = null,
    version = null,
    modelName = null,
    providerName = null,
    providerIsLocal = null,
    projectCount = 0,
    conversationCount = 0,
    sourceCount = 0,
    memoryCount = 0,
    agentCount = 0,
  } = snapshot;

  const lines = [];
  lines.push(`Product: ${label(productName)}${edition ? ` (${label(edition)})` : ''}${version ? `, version ${label(version, 32)}` : ''}. Self-hosted: it runs on the operator's own machine, not on a vendor's servers.`);

  // Which model is answering is the single most useful fact a person can be told, and the one the
  // product used to keep to itself (F-MODEL-001 names the same gap on the #/models surface).
  if (modelName || providerName) {
    // `via` only makes sense AFTER a model name. Joining the two fragments unconditionally
    // produced "You are being served by via Local OpenAI-compatible" on the live installation the
    // first time this ran — a provider whose model name sits in a different field than the caller
    // read. The sentence is now correct for all three combinations, so a future caller passing
    // only one of them gets prose rather than a seam.
    const who = modelName
      ? `model ${label(modelName, 64)}${providerName ? ` via ${label(providerName)}` : ''}`
      : label(providerName);
    const where = providerIsLocal === true ? ', running inside this installation' : providerIsLocal === false ? ', running on an external service the operator configured' : '';
    lines.push(`You are being served by ${who}${where}. If you are asked which model you are, answer with that and do not guess.`);
  }

  lines.push(`Workspace contents right now: ${projectCount} project(s), ${conversationCount} conversation(s), ${sourceCount} document source(s), ${memoryCount} stored memory item(s), ${agentCount} agent(s).`);
  return lines;
}

/**
 * What the assistant can actually do this turn — the enabled tools, by name, or the honest
 * absence of them.
 *
 * The absence sentence matters as much as the list. A model with no tools that has not been told
 * so will still answer "let me check that for you" and then check nothing, which reads to a person
 * as the product being broken rather than as the product being unconfigured.
 */
export function describeCapabilities(tools = []) {
  if (!tools.length) {
    return ['You have no tools enabled in this conversation. You cannot read files, run commands, browse, or inspect this installation directly — so do not claim or imply that you are about to. If answering properly needs one, say which kind of tool is missing.'];
  }
  const listed = namedList(tools, (tool) => {
    const name = label(tool?.name);
    if (!name) return '';
    const description = label(tool?.description, 96);
    return description ? `${name} (${description})` : name;
  });
  return [
    `Tools you can call in this conversation: ${listed}.`,
    'When a tool can answer a question, call it and answer from its real result. That is not limited to this installation: product names, model numbers, versions, prices, availability, and anything else that can have changed since you were trained are to be looked up with the tool, never recalled. Do not describe how someone could find out — that is the single most useless answer you can give a person who is already looking at the thing.',
  ];
}

/** The register. This is the part that turns a general-purpose completion into a chat someone
 *  wants to keep talking to, and every line of it was written against a specific failure seen in
 *  the live message log rather than as generic prompt-craft. */
export const CONVERSATION_STYLE = [
  'How to answer:',
  '- Answer the question that was actually asked, in your first sentence. No preamble, no restating the question back, no "great question".',
  '- Reply in the language the person used. If they write Italian, answer in Italian.',
  '- Be direct and concrete. A numbered tutorial on the general case is the wrong answer to a question about this installation; use the facts above, or call a tool, or say what you would need.',
  '- Say plainly when something is not configured here, not possible here, or something you do not know. An honest "not set up" beats a confident guess every time.',
  '- Never invent a file, a setting, a command, a path or a result — and never invent a product name, a model number, a version or a price either. If you did not read it or run it, say so.',
  '- When you answer from a search, name the addresses you used and say that they are not verified: this installation does not vouch for what it fetched, and neither do you.',
  '- Match the length to the question. A one-line question gets a one-line answer.',
  '- You are talking to the person who owns and runs this installation. Speak to them as an engineer speaks to another engineer, not as a manual speaks to a stranger.',
].join('\n');

/**
 * The snapshot, derived from the workspace state and the environment.
 *
 * This lives here, and is pure, for one measured reason: the first version of it sat inline in
 * `server.mjs` reading `profile.model` and `profile.kind`, and the real record carries
 * `defaultModel` and `type`/`external`. Nothing caught it — not review, not the suite — because an
 * inline function has no test, and a test written alongside it would have invented a fixture with
 * the same wrong names. Pure and exported, it can be pinned against a profile the REAL
 * `ProviderGateway` created, which is the only fixture whose field names are not a guess.
 *
 * `env` is passed rather than read so the four voice states are reachable from a test without
 * mutating the process.
 */
export function installationFromState(state, env = {}, product = {}) {
  const profile = state?.providerProfiles?.find((item) => item.id === state?.settings?.defaultProviderId) ?? null;
  return {
    productName: product.name ?? 'NOESAR Evolution',
    edition: product.edition ?? null,
    version: product.version ?? null,
    modelName: profile?.defaultModel ?? null,
    providerName: profile?.name ?? null,
    // `external` is the product's own explicit answer to "do these words leave the machine". The
    // first version derived it from the type string and got it backwards on the live installation.
    providerIsLocal: profile ? profile.external === false : null,
    projectCount: state?.projects?.length ?? 0,
    conversationCount: state?.conversations?.length ?? 0,
    agentCount: state?.agents?.length ?? 0,
  };
}

/**
 * Compose the whole system message.
 *
 * Ordered deliberately: identity, then the installation, then capability, then the mode, then the
 * operator's own instructions and memory last — the operator's words are the ones that should be
 * freshest when the model starts generating, and they are also the ones allowed to override the
 * defaults above them.
 */
export function composeSystemPrompt({
  mode = 'ASK',
  installation = {},
  tools = [],
  hasEvidence = false,
  projectInstructions = '',
  memoryText = '',
  extraInstructions = [],
} = {}) {
  const sections = [];
  sections.push([
    `You are the assistant built into ${label(installation.productName ?? 'NOESAR Evolution')}.`,
    'You are not a general-purpose chatbot running on someone else\'s servers: you are part of a self-hosted product, you are talking to the person who operates it, and the facts below describe THAT installation as it is right now.',
  ].join(' '));

  sections.push(['This installation:', ...describeInstallation(installation).map((line) => `- ${line}`)].join('\n'));
  sections.push(describeCapabilities(tools).join('\n'));
  sections.push(instructionForMode(String(mode ?? 'ASK').toUpperCase(), { hasEvidence }));
  sections.push(CONVERSATION_STYLE);

  for (const extra of extraInstructions) if (extra) sections.push(String(extra));
  if (projectInstructions) sections.push(String(projectInstructions));
  if (memoryText) sections.push(String(memoryText));

  return sections.filter(Boolean).join('\n\n');
}
