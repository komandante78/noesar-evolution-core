// SPDX-License-Identifier: AGPL-3.0-or-later
//
// D-0277: the one-click path onto the D-0274/D-0275 activation framework for modules
// NOESAR itself builds and supports (`trust_level:"noesar-official"`). Owner feedback,
// verbatim: "non deve essere così complicato... fai in settings sezione moduli owner e
// moduli utenti... da lì fai vedere sempre in anteprima i moduli installati e attivi con
// pulsante attiva/disattiva o installa" — the seven-call request/approve/sign/install/
// grant/approve/activate sequence a human would otherwise have to drive by hand collapses
// here into two button clicks (Install, Activate), each still owner+CSRF+strong-reauth
// gated (server.mjs's routes), because the SERVER performs the registration/signing/
// grant-minting on the Owner's behalf instead of asking them to.
//
// "Moduli utenti" (customer-private/community, self-service) is deliberately NOT built
// here — a stranger's arbitrary manifest and key is a materially different trust
// decision (no NOESAR-controlled signing key, no fixed catalog) and needs its own design
// pass, named as future work rather than folded in.
//
// The catalog is a fixed allowlist, like KNOWN_MODULES (modules-registry.mjs,
// superseded) before it — `install`/`activate` mint manifests ONLY for ids listed here,
// never for an arbitrary client-supplied id.

export const OWNER_PUBLISHER_ID = 'noesar';
export const OWNER_PUBLISHER_TRUST_LEVEL = 'noesar-official';

export const OWNER_MODULE_CATALOG = Object.freeze([
  Object.freeze({
    id: 'debug-evolution',
    name: 'Debug Evolution',
    description: 'Static code analysis and security scanning — a separate product on the LAN, opened as an external link (its own CSP forbids an iframe, verified live in D-0273).',
    externalUrl: 'http://192.168.178.100:8787',
    buildManifest: () => ({
      id: 'debug-evolution',
      version: '1.1.0',
      publisher: OWNER_PUBLISHER_ID,
      trust_level: OWNER_PUBLISHER_TRUST_LEVEL,
      sector: ['software-development', 'code-security'],
      intended_use: [
        'static code analysis and security scanning of repositories the operator explicitly registers as projects',
        "read-only review of scan findings (Program Genome graph, Evidence Court finding lifecycle, SARIF export) via its own WebUI",
      ],
      excluded_use: [
        'automatic remediation applied without human review',
        'scanning any repository not explicitly registered as a project inside Debug Evolution',
        'production code execution',
        'physical actuation',
      ],
      jurisdictions: [],
      data_classes: ['source-code'],
      // Honestly declared even though the sidebar is a plain external link with no
      // backend proxying: the browser's own navigation to it is network egress to a LAN
      // service this repository does not own or operate.
      permissions: ['network.external'],
      evidence: [
        { kind: 'product-closure-report', ref: '/mnt/user/downloads/DEBUG_EVOLUTION/FINAL_REPORTS/', note: 'CLOSURE_STATUS=FINAL_PASS, 9-phase install qualification gate' },
        { kind: 'security-header-verified-live', ref: 'docs/DECISION_LOG.md D-0273/D-0277', note: "Content-Security-Policy: frame-ancestors 'none' reconfirmed live" },
      ],
      human_oversight: { required: true, decisionAuthority: 'Owner', overrideAvailable: true },
      safety_interlock: { required: false, emergencyStop: false, externalController: false },
    }),
  }),
  Object.freeze({
    id: 'agenti',
    name: 'Agenti',
    description: 'Multi-agent analysis of the repositories on this host — a central planner splits a request into specialised agents (debug, line-by-line review, attack surface, vulnerabilities, secrets, supply chain, document truth, grant readiness) that may delegate sub-agents. Read-only by construction, opened as an external link.',
    externalUrl: 'http://192.168.178.100:8099',
    buildManifest: () => ({
      id: 'agenti',
      version: '1.0.0',
      publisher: OWNER_PUBLISHER_ID,
      trust_level: OWNER_PUBLISHER_TRUST_LEVEL,
      sector: ['software-development', 'code-security'],
      intended_use: [
        'read-only analysis, by specialised agents, of the repositories the Owner declares in AGENTI_ROOTS',
        'conversational commands over those same repositories from the module\'s own WebUI',
      ],
      excluded_use: [
        'any write to the repositories it reads: the module carries four read-only tools (list, tree, read, grep) and no write path',
        'running arbitrary commands on the host',
        'reading anything outside the declared roots — path traversal and absolute paths are refused',
        'treating a finding as established without a human reading the file and line it cites',
      ],
      jurisdictions: [],
      data_classes: ['source-code'],
      // Declared for the same reason Debug Evolution declares it: the sidebar entry is a
      // plain link and the browser's navigation to it is egress to a LAN service this
      // repository does not operate. The module itself has NO authentication of its own —
      // whoever reaches port 8099 on the LAN reaches it without a NOESAR session.
      permissions: ['network.external'],
      evidence: [
        { kind: 'module-source', ref: '/mnt/cachec/AGENTI/', note: 'five files, zero dependencies, deliberately outside this repository' },
        { kind: 'self-test', ref: 'node /mnt/cachec/AGENTI/server.mjs --selftest', note: 'path jail, context bound and finding verification asserted before the server will start' },
      ],
      human_oversight: { required: true, decisionAuthority: 'Owner', overrideAvailable: true },
      safety_interlock: { required: false, emergencyStop: false, externalController: false },
    }),
  }),
]);

export function findCatalogEntry(id) {
  return OWNER_MODULE_CATALOG.find((entry) => entry.id === id) ?? null;
}
