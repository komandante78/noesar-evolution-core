// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The local-first privacy indicator — `01_PRODUCT/12`.
//
// Two things live in this file and they are deliberately kept apart:
//
//   `evaluateEgress`  answers a question about a hypothetical egress. It is a PLAN.
//                     Its four answers are published in conformance/authority-vectors.json.
//   `derivePrivacy`   reports what is actually true of this installation right now.
//                     It is a FACT, computed from configuration nobody has to be trusted
//                     to report honestly.
//
// They used to be the same thing, and that was a defect rather than a simplification: the
// server assigned `currentPrivacyState = plan.state`, so any authenticated caller asking
// "what would happen if I used a remote model?" flipped the whole installation's banner to
// REMOTE_MODEL_ACTIVE — for every user, permanently, on the strength of a request that had
// just been REFUSED. An indicator that reports the last question anyone asked is not an
// indicator. The state is now derived from enabled providers and consented connectors, so
// there is nothing for a caller to set.
//
// The second reason to derive rather than store: a stored state cannot survive a restart
// honestly. It either persists a claim nobody re-checked, or it resets to an optimistic
// default — and the old code did the latter, asserting LOCAL_ONLY_*VERIFIED* at module
// load, before anything had been verified. That is what STATUS_UNKNOWN is for.
//
// The dependency runs one way: privacy describes what the update path would send, and the
// update path knows nothing about privacy.
import { updateCheckMetadata } from './update-manager.mjs';

/** The seven states of `01_PRODUCT/12`, verbatim. */
export const PrivacyState = Object.freeze({
  LOCAL_ONLY_VERIFIED: 'LOCAL_ONLY_VERIFIED',
  EXTERNAL_METADATA_ONLY: 'EXTERNAL_METADATA_ONLY',
  EXTERNAL_CONNECTOR_PENDING: 'EXTERNAL_CONNECTOR_PENDING',
  EXTERNAL_CONNECTOR_ACTIVE: 'EXTERNAL_CONNECTOR_ACTIVE',
  REMOTE_MODEL_ACTIVE: 'REMOTE_MODEL_ACTIVE',
  POLICY_VIOLATION_BLOCKED: 'POLICY_VIOLATION_BLOCKED',
  STATUS_UNKNOWN: 'STATUS_UNKNOWN',
});

/**
 * The eight elements `01_PRODUCT/12` requires an external state to show. Exported so the
 * disclosure builder and its test measure the same list rather than two copies of it.
 */
export const REQUIRED_DISCLOSURE_FIELDS = Object.freeze([
  'destination', 'serviceIdentity', 'dataCategories', 'purpose',
  'duration', 'retention', 'consentScope', 'revoke',
]);

/**
 * The revoke control the disclosure advertises. A control named in a disclosure and not
 * wired to anything would be the same false claim this indicator exists to prevent, so
 * the route named here is asserted by the test suite.
 */
export const REVOKE_CONTROL = Object.freeze({
  method: 'POST',
  path: '/api/v1/privacy/revoke',
  requires: 'provider.manage',
  effect: 'Withdraws consent from every external provider and connector and disables them. Local operation continues.',
});

/**
 * The revoke element as shown to a PARTICULAR caller.
 *
 * `user`, `client_restricted` and `service_account` all hold `user.read`, so they can read
 * this indicator — but none of them holds `provider.manage`, so the route would answer 403.
 * Showing all three a control they cannot use would be the same false claim this file
 * exists to remove, only pointed at the reader instead of the operator. `available` is not
 * a second copy of the rule: the server passes the answer from the very `hasPermission`
 * call the route enforces.
 *
 * Widening the permission was the other option and was rejected: revoke disables providers
 * for the whole workspace, so a restricted account could switch off everyone's access.
 * Saying plainly who may do it is better than either lying or handing out the lever.
 */
function revokeControlFor(canRevoke) {
  if (canRevoke === undefined) return REVOKE_CONTROL;
  return Object.freeze({
    ...REVOKE_CONTROL,
    available: Boolean(canRevoke),
    ...(canRevoke ? {} : { unavailableReason: 'Your role cannot change provider configuration. Ask an administrator or the owner to revoke.' }),
  });
}

/**
 * Severity order, worst first. When several things are true at once the indicator reports
 * the most exposing one: an installation with a blocked violation AND an active remote
 * model must not describe itself by the milder of the two.
 */
const SEVERITY = Object.freeze([
  PrivacyState.POLICY_VIOLATION_BLOCKED,
  PrivacyState.REMOTE_MODEL_ACTIVE,
  PrivacyState.EXTERNAL_CONNECTOR_ACTIVE,
  PrivacyState.EXTERNAL_CONNECTOR_PENDING,
  PrivacyState.EXTERNAL_METADATA_ONLY,
  PrivacyState.LOCAL_ONLY_VERIFIED,
  PrivacyState.STATUS_UNKNOWN,
]);

const worst = (states) => SEVERITY.find((candidate) => states.includes(candidate)) ?? PrivacyState.STATUS_UNKNOWN;

/**
 * `01_PRODUCT/12`: "Telemetry is off by default." This product has no telemetry emitter at
 * all, which is the strongest form of that guarantee — but an absence nobody states cannot
 * be shown in an indicator, and cannot be regression-tested. Stating it here gives the test
 * suite something to defend: adding an emitter later fails a test rather than quietly
 * making this line false.
 */
export const TELEMETRY_POSTURE = Object.freeze({
  enabled: false,
  configurable: false,
  detail: 'This build contains no telemetry, usage-analytics or crash-reporting client. There is nothing to enable.',
});

/** Host only. A full URL in a banner invites a credential or a path to be shown with it. */
function destinationOf(value) {
  if (!value) return 'UNKNOWN_DESTINATION';
  try { return new URL(String(value)).host; } catch { return 'UNKNOWN_DESTINATION'; }
}

/**
 * Retention at a third party is not observable from this host. Reporting a figure would be
 * fabrication, and reporting nothing would leave a required disclosure element blank, so it
 * is named as unknowable and paired with the retention this product does control.
 */
function retentionOf(retentionDays) {
  return {
    atDestination: 'UNKNOWN_AT_DESTINATION',
    note: 'What the destination retains is governed by its operator and cannot be verified from this installation.',
    localRetentionDays: Number.isFinite(retentionDays) ? Number(retentionDays) : null,
  };
}

function providerDisclosure(profile, retentionDays, canRevoke) {
  const consent = profile.consent ?? {};
  return {
    kind: 'remote-model',
    id: profile.id,
    destination: destinationOf(profile.baseUrl),
    serviceIdentity: `${profile.name ?? profile.type ?? 'External provider'} (${profile.type ?? 'unknown type'})`,
    dataCategories: consent.dataClasses?.length ? [...consent.dataClasses] : ['prompt'],
    purpose: 'Model inference requested by this workspace.',
    duration: consent.grantedAt ? `Consent granted ${consent.grantedAt}; in force until revoked.` : 'In force until revoked.',
    retention: retentionOf(retentionDays),
    consentScope: {
      projects: consent.projectIds?.length ? [...consent.projectIds] : 'all projects',
      dataClasses: consent.dataClasses?.length ? [...consent.dataClasses] : ['prompt'],
      toolSchemas: Boolean(consent.allowTools),
      anonymised: consent.anonymize !== false,
    },
    revoke: revokeControlFor(canRevoke),
  };
}

function toolDisclosure(tool, retentionDays, pending, canRevoke) {
  const consent = tool.consent ?? {};
  return {
    kind: 'connector',
    id: tool.id,
    destination: destinationOf(tool.endpoint),
    serviceIdentity: `${tool.name ?? 'External connector'} (${tool.transport ?? 'external'})`,
    dataCategories: ['tool arguments'],
    purpose: pending
      ? 'Connector registered and awaiting explicit consent. Nothing has been sent.'
      : 'Tool calls issued on behalf of this workspace.',
    duration: pending
      ? 'No connection is open; consent has not been granted.'
      : `Consent granted ${consent.grantedAt ?? 'at an unrecorded time'}; in force until revoked.`,
    retention: retentionOf(retentionDays),
    consentScope: {
      projects: consent.projectIds?.length ? [...consent.projectIds] : (pending ? 'none — not yet granted' : 'all projects'),
      dataClasses: ['tool arguments'],
      toolSchemas: true,
      anonymised: false,
    },
    revoke: revokeControlFor(canRevoke),
  };
}

/**
 * Compute the indicator from what is configured.
 *
 * `observed:false` means no check has been performed — the state is STATUS_UNKNOWN and the
 * banner says so. It is not an error path; it is the honest answer before the first read.
 *
 * @param {object} input
 * @param {boolean} input.observed        whether the configuration was actually read
 * @param {Array}   [input.providers]     provider profiles as stored
 * @param {Array}   [input.tools]         tool/connector records as stored
 * @param {boolean} [input.updateMetadataEgress]  an update check would leave this host
 * @param {object}  [input.lastViolation] the most recent refusal, if one is being reported
 * @param {number}  [input.retentionDays] this installation's own retention setting
 */
export function derivePrivacy(input = {}) {
  if (!input.observed) {
    return {
      state: PrivacyState.STATUS_UNKNOWN,
      disclosures: [],
      telemetry: TELEMETRY_POSTURE,
      reason: 'The privacy state has not been read from configuration yet.',
    };
  }

  const providers = Array.isArray(input.providers) ? input.providers : [];
  const tools = Array.isArray(input.tools) ? input.tools : [];
  const retentionDays = input.retentionDays;

  // A provider is a live remote model only when it is external, enabled AND consented.
  // Any one of the three missing means nothing can be sent through it.
  const activeProviders = providers.filter((item) => item.external && item.enabled && item.consent?.granted);

  // "Pending" means someone has moved a destination TOWARDS use and it is not yet
  // authorised — enabled without consent, or consented without being enabled. It does not
  // mean "an entry exists".
  //
  // That distinction is the whole value of the state, and getting it wrong was caught
  // here by this file's own test. `ProviderGateway.seed()` registers OpenAI, Anthropic and
  // Kimi in every workspace, disabled and unconsented, as a catalogue to choose from.
  // Treating a registered-but-untouched profile as pending meant a fresh installation that
  // had never gone near an external provider reported EXTERNAL_CONNECTOR_PENDING for ever
  // and could never once say LOCAL_ONLY_VERIFIED. A warning that is always on is a warning
  // users learn to skip past, which would have made this indicator worse than none.
  //
  // An inert catalogue entry is a menu, not a connection. Nothing can be sent through it,
  // so it is neither disclosed nor allowed to colour the state.
  const pendingProviders = providers.filter((item) =>
    item.external && Boolean(item.enabled) !== Boolean(item.consent?.granted));

  const activeTools = tools.filter((item) => item.external && !item.disabled && item.consent?.granted);
  const pendingTools = tools.filter((item) => item.external && !(item.consent?.granted && !item.disabled));

  const disclosures = [
    ...activeProviders.map((item) => providerDisclosure(item, retentionDays, input.canRevoke)),
    ...activeTools.map((item) => toolDisclosure(item, retentionDays, false, input.canRevoke)),
    ...pendingProviders.map((item) => ({ ...providerDisclosure(item, retentionDays, input.canRevoke), kind: 'remote-model-pending', purpose: 'Provider configured and awaiting consent or activation. Nothing has been sent.' })),
    ...pendingTools.map((item) => toolDisclosure(item, retentionDays, true, input.canRevoke)),
  ];

  const candidates = [];
  if (input.lastViolation) candidates.push(PrivacyState.POLICY_VIOLATION_BLOCKED);
  if (activeProviders.length) candidates.push(PrivacyState.REMOTE_MODEL_ACTIVE);
  if (activeTools.length) candidates.push(PrivacyState.EXTERNAL_CONNECTOR_ACTIVE);
  if (pendingProviders.length || pendingTools.length) candidates.push(PrivacyState.EXTERNAL_CONNECTOR_PENDING);
  if (input.updateMetadataEgress) candidates.push(PrivacyState.EXTERNAL_METADATA_ONLY);
  if (!candidates.length) candidates.push(PrivacyState.LOCAL_ONLY_VERIFIED);

  const state = worst(candidates);
  return {
    state,
    disclosures: state === PrivacyState.LOCAL_ONLY_VERIFIED ? [] : disclosures,
    telemetry: TELEMETRY_POSTURE,
    ...(input.lastViolation ? { violation: input.lastViolation } : {}),
  };
}

export function privacyBanner(state) {
  if (state === PrivacyState.LOCAL_ONLY_VERIFIED) {
    return {
      headline: 'NOESAR runs locally on your device.',
      detail: 'No data is sent to external servers.',
      verified: true,
      external: false,
    };
  }
  if (state === PrivacyState.STATUS_UNKNOWN) {
    return {
      headline: 'Privacy state not confirmed.',
      detail: 'The configuration has not been read, so no guarantee is being made either way.',
      verified: false,
      external: false,
    };
  }
  if (state === PrivacyState.POLICY_VIOLATION_BLOCKED) {
    return {
      headline: 'An external request was blocked by policy.',
      detail: 'Nothing was sent. Review the audit trail for the refused request.',
      verified: false,
      external: true,
    };
  }
  if (state === PrivacyState.EXTERNAL_CONNECTOR_PENDING) {
    return {
      headline: 'An external connection is configured but not active.',
      detail: 'Consent has not been granted, so nothing has been sent yet.',
      verified: false,
      external: true,
    };
  }
  return {
    headline: 'External connection active or requested.',
    detail: 'Review the exact destination and data scope before continuing.',
    verified: false,
    external: true,
  };
}

export function evaluateEgress(request = {}) {
  const kind = String(request.kind ?? 'none');
  if (kind === 'none') return { state: PrivacyState.LOCAL_ONLY_VERIFIED, allowed: true, data: [] };
  if (kind === 'signed-update-metadata') {
    // The field list is not written here. It is asked of the module that would actually
    // build the payload, so the disclosure cannot drift away from what is sent — the
    // same reasoning as the invariant list moving out of the WebUI and into the server.
    return { state: PrivacyState.EXTERNAL_METADATA_ONLY, allowed: false, requiresApproval: true, data: updateMetadataDataCategories() };
  }
  if (kind === 'remote-model') {
    return { state: PrivacyState.REMOTE_MODEL_ACTIVE, allowed: false, requiresApproval: true, data: request.data ?? ['prompt'] };
  }
  if (kind === 'connector') {
    return { state: PrivacyState.EXTERNAL_CONNECTOR_ACTIVE, allowed: false, requiresApproval: true, data: request.data ?? [] };
  }
  return { state: PrivacyState.POLICY_VIOLATION_BLOCKED, allowed: false, reason: 'Unknown egress type' };
}

/**
 * Human-readable names for exactly the keys `updateCheckMetadata` emits. Derived from the
 * producer, so a field added there without a name here fails loudly rather than being
 * disclosed as nothing.
 */
const METADATA_LABELS = Object.freeze({
  productVersion: 'product version',
  platform: 'platform',
  channel: 'update channel',
});

function updateMetadataDataCategories() {
  return Object.keys(updateCheckMetadata({ installedVersion: '0.0.0', channel: 'offline' }))
    .sort()
    .map((key) => METADATA_LABELS[key] ?? `UNDECLARED FIELD: ${key}`);
}
