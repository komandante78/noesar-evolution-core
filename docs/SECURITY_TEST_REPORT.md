# Phase 4 — security test report

41 checks against a live instance: **38 PASS, 2 PARTIAL, 1 BLOCKED, 0 FAIL** when run
in-container, where the file extractors exist. Driver: `tools/acceptance/a3-security.mjs`.
Evidence: `docs/ACCEPTANCE_RESULTS.tsv`, section `SEC`.

Authentication and session results are in the `AUTH` section (27/27 PASS); the sandbox is in
`docs/SANDBOX_TEST_REPORT.md`; injection is in `docs/PROMPT_INJECTION_TEST_REPORT.md`.

## Web and API surface

| # | Check | Observed |
|---|---|---|
| SEC-01 | foreign `Host` header | 421 Unrecognized Host header |
| SEC-02 | security headers on every response | all 7 present: nosniff, `X-Frame-Options: DENY`, `no-referrer`, COOP, CORP, permissions-policy, `no-store` |
| SEC-03 | CSP on the HTML document | `default-src 'self'`, `object-src 'none'`, `frame-ancestors 'none'`, no `unsafe-inline`, no `unsafe-eval` |
| SEC-04 | cross-origin read | no `Access-Control-Allow-Origin` is ever emitted, and there is no preflight handler (404) |
| SEC-05 | forged cross-origin POST | 403 CSRF validation failed |
| SEC-06 | reflected XSS probe | echoed only as `application/json`; unknown paths answer JSON, never HTML |
| SEC-07 | oversized body | service stays alive; hard cap 64 MiB in `body()` |
| SEC-08 | unauthenticated diagnostics | `/diagnostics` 401, `/api/v1/audit` 401, `/api/v1/logs` 401, `/api/v1/debug/bundle` 401 |
| SEC-09 | metrics | Prometheus text with `noesar_build_info` and an up gauge, 49 lines, no conversation content |
| SEC-10 | error disclosure | no stack, no filesystem path, no `node:internal` in any error body |
| SEC-11 | unknown identifiers | clean 404, no oracle |
| SEC-12 | static path traversal | four encodings all 404, nothing leaked |
| SEC-13 | brute force | 8×401 then 429 from the sliding-window limiter |

On CORS: the correct reading is that there is **no CORS implementation**, and that the
absence *is* the restrictive posture — a browser will not expose a cross-origin response
without a grant. Phase 3's matrix claimed "CORS IMPLEMENTED" and cited a test file
containing no CORS test; that row is now corrected (F4-008). What actually protects
state-changing requests is `SameSite=Strict` cookies plus a required `x-noesar-csrf` header,
both verified.

`/metrics` answers 200 from loopback by design — `isInternalAddress()` treats an internal
caller as inside the trust boundary, and the container publishes on loopback only. A
non-internal caller must present a session with `audit.read`.

## SSRF and egress

SEC-14 registers an external tool against ten hostile endpoints and every one is refused at
registration: metadata IPv4, GCP metadata, Alibaba metadata, loopback, all three RFC1918
ranges, `host.docker.internal`, plain HTTP, and a URL with embedded credentials.

SEC-39 and SEC-40 together are the egress proof, and the pair matters more than either half:

- **SEC-39** — an external provider that is *enabled but not consented* is refused with
  "Explicit external-provider consent is required", raised by `#assertAllowed()` inside
  `#prepared()` **before** `fetch()`. No network-layer error appears, because no connection
  was attempted.
- **SEC-40** — the same provider *with* consent and a synthetic credential reaches the
  network layer and fails on `ENOTFOUND`. So the gate is what stops egress, not an absence
  of capability. A test that only showed the refusal could not distinguish the two.

SEC-41 verifies redaction on what an external provider would receive: email, API key and IP
are replaced, 3 replacements counted by class.

Also checked and dismissed as a false positive: a client can pass `external: false` when
creating a provider, but `validateBaseUrl()` re-validates the URL against the flag, so an
external URL cannot be reclassified as internal — `https://api.openai.com/v1` with
`external: false` is rejected (SEC-27 in the WORK series). The flag and the URL are validated
together, so the consent bypass this appeared to allow does not exist.

**SEC-15 is a real, accepted limitation** (F4-010): validation checks the hostname *string*,
so a name resolving to an internal address passes. Exploiting it requires
`provider.manage` or `agent.manage` — owner or admin. Recorded as PARTIAL, not passed.

## File handling

| # | Check | Observed |
|---|---|---|
| SEC-16 | capability honesty | in-container: text, pdf, ocr, archives, officeXml, mediaMetadata all true, with limits reported |
| SEC-17 | traversal filename | `../../../etc/passwd` stored as `passwd` under a uuid blob id |
| SEC-18 | null byte, absolute path | sanitised to `evil_.txt` and `shadow` |
| SEC-19 | oversized upload | capped; see F4-012 on the limit interaction |
| SEC-20 | 1300-entry archive | 413 "Archive contains too many entries", service alive |
| SEC-21 | compression bomb | 200 MiB of `0x41` compressed to 199 KiB; extraction capped at 203 696 bytes, service alive |
| SEC-22 | uploaded executable | shell script and ELF both stored inert; the side-effect file the script would have created does not exist |
| SEC-23 | hostile SVG | stored as text; no route serves a stored blob with its original content type |
| SEC-25 | symlink in an archive | no `/etc/passwd` content in the extraction — entries are read with `unzip -p`, never written out |

**SEC-24 is a recorded limitation** (F4-011): extraction is routed by extension and declared
MIME with no magic-byte sniffing. It is a correctness limitation, not an execution risk —
extractors run with `shell:false` on a temp path and nothing is ever executed.

## Secrets and audit

- **SEC-36** — a per-run random canary was written into a memory and sent through a chat
  turn, then searched in five places: API logs, API audit, the diagnostic bundle, the log
  file on disk and the audit file on disk. **Leaked in none.**
- **SEC-37** — audit history cannot be modified through the API: DELETE, POST, PUT and PATCH
  on `/api/v1/audit` all 404, and the ledger stays readable.
- **SEC-38** — the ledger is genuinely hash-chained: 152 records, all carrying
  `previousHash`/`hash`, and **151/151 links verify** against the previous record's hash. The
  service's own `ledger.verify()` agrees.
- **WORK-33** — a provider API key is not retrievable in plaintext from the provider list,
  from the data export, or from the state file on disk. **WORK-34** — revocation clears
  `credentialConfigured`.

## What this report does not cover

- No independent penetration test. The same party wrote the fixes and the tests; the matrix
  row now says so, and `docs/PRODUCTION_READINESS_V050.md` still requires an external test
  before promotion.
- No TLS. The installation is loopback-only and `NOESAR_SECURE_COOKIES=false` follows from
  that. Any exposure beyond loopback needs TLS and that flag flipped, and neither was in
  scope here.
- No passkey/WebAuthn: absent, and the matrix says MISSING rather than PARTIAL.
- User-to-user isolation is **not reachable** in this build (F4-008): no route creates a
  second user, and the reference data plane has no per-user ownership. Per-project isolation
  is implemented and verified.
