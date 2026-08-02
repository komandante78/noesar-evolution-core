// SPDX-License-Identifier: AGPL-3.0-or-later
//
// D-0292: the pure half of an API-target probe — turning a registry record plus its
// decrypted credential into the request body Debug Evolution's `POST /api/v2/api-probe`
// expects. Kept apart from `debug-evolution-bridge.mjs`'s HTTP for the same reason
// `debug-evolution-triage.mjs`'s conversion is kept apart from it: this can be tested
// without a network, and the one assertion that matters most about it — that the secret
// goes exactly one place and appears nowhere else — is an assertion about a returned
// object, not about a request that has to be intercepted to be seen.
//
// WHY THE CREDENTIAL CROSSES THE MODULE AT ALL, stated rather than buried:
//
// D-0286 established that Debug Evolution never sees an SSH credential — NOESAR runs `scp`
// and hands over files. The same trick is not available here, and not for want of trying:
// `remote-api.pyz` is a Python zipapp and the NOESAR container has no `python3` (verified,
// s305: `openssl`, `ssh`, `scp`, `tar` and `node` are present; `python3` and `curl` are
// not). Putting a Python runtime into NOESAR's image to keep a token out of the module
// would also put the toolpack on the wrong side of the module boundary the whole product
// is built around.
//
// So the honest description is: NOESAR remains the only place an API credential is STORED,
// and the module is where it is USED, for the length of one probe. It is never written to
// disk there, never placed in a process argument (the module talks to the toolpack over
// its `rpc` verb on stdin precisely for that reason), and never recorded — the toolpack
// redacts `authorization`/`cookie`/`x-api-key` out of everything it returns.
//
// This is a weaker property than the SSH case and is not claimed to be equal to it. It is
// also a different kind of secret: an SSH private key opens a whole machine and is merely
// the means of fetching source, while an API token is scoped to the very service being
// examined — it is the thing under test, and no probe of an authenticated endpoint can
// avoid handing it to whoever makes the request.

/** The budget every probe runs under. Small on purpose: this is an observation, not a load
 *  test, and `remote-api.pyz` enforces each of these from inside. `maxRedirects: 0` keeps a
 *  redirect from silently carrying the credential to a host the Owner never allow-listed —
 *  the toolpack re-validates the policy on every hop, but not following one at all is the
 *  stronger guarantee and costs nothing here. */
export const PROBE_BUDGET = Object.freeze({
  max_requests: 8,
  max_response_bytes: 2_000_000,
  timeout_seconds: 20,
  requests_per_second: 2,
  max_redirects: 0,
});

/**
 * Builds the probe request body for one target.
 *
 * `credentialHeaders` comes from `ApiTargetRegistry.resolveCredentialHeaders()` and is the
 * ONLY part of the returned object that carries a secret. Everything else — the URL, the
 * grants, the budget — is safe to log; `describeProbeSpec()` below exists so callers that
 * want to log something have an obvious thing to log that is not this.
 */
export function buildProbeSpec(target, credentialHeaders = {}) {
  if (!target?.baseUrl) throw Object.assign(new Error('An API target needs a base URL before it can be probed.'), { status: 400 });
  return {
    name: target.name,
    base_url: target.baseUrl,
    protected_path: target.protectedPath || '',
    authorization: {
      // `allow_remote_testing` is what the toolpack requires before it will make any request
      // at all; probing IS the operation, so it is implied by the target existing. The other
      // four are the Owner's per-target decisions, passed through unchanged.
      allow_remote_testing: true,
      allow_private_targets: Boolean(target.allowPrivateTargets),
      allow_mutation: Boolean(target.allowMutation),
      allow_intrusive: Boolean(target.allowIntrusive),
      allow_billable_request: Boolean(target.allowBillable),
    },
    budget: { ...PROBE_BUDGET },
    headers: { ...credentialHeaders },
  };
}

/** The same spec with the credential replaced by the NAMES of the headers it would have
 *  set. Safe for a ledger entry, an error message or a log line. */
export function describeProbeSpec(spec) {
  return {
    base_url: spec.base_url,
    protected_path: spec.protected_path,
    authorization: spec.authorization,
    credential_headers: Object.keys(spec.headers ?? {}),
  };
}
