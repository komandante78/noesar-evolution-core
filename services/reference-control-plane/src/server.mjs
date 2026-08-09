// SPDX-License-Identifier: AGPL-3.0-or-later
import { createServer } from 'node:http';
import { createServer as createHttpsServer } from 'node:https';
import { chmodSync, chownSync, cpSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { randomBytes, randomUUID, generateKeyPairSync, createPrivateKey, createPublicKey, createHash } from 'node:crypto';
import { AuditLedger } from './audit.mjs';
import { authorityStatus, assertReferenceRuntimeAllowed } from './authority.mjs';
import {
  DataPlaneMode, dataPlaneStatus, assertDevelopmentDataPlane, describeDataPlane,
} from './data-plane.mjs';
import { PostgresSupervisor } from './postgres-supervisor.mjs';
import { UserDirectory } from './user-directory.mjs';
import { LocalModelRuntime } from './local-model-runtime.mjs';
import { buildCatalog, planAcquisition } from './model-catalog.mjs';
import { ActiveModelState, resolveActiveModel, activeModelReport } from './active-model.mjs';
import { voiceRoutingFrom, voiceReadiness, transcribe, speak, VoiceEngineError } from './voice-engine.mjs';
import { chooseDestination, VoiceChoice } from './voice-interpreter.mjs';
import { AuthService, parseCookies, ROLES, MFA_REQUIRED_ROLES, mayReadHealthDetail } from './auth.mjs';
import { AuthStore } from './auth-store.mjs';
import { resolveSetupToken } from './setup-token.mjs';
import { discoverHardware, recommendRuntime } from './hardware.mjs';
import {
  securityHeaders, validHostHeader, isWildcardAddress,
  resolveBindScope, allowsUnauthenticatedMetrics, allowsUnauthenticatedHealthDetail,
} from './http-security.mjs';
import { INVARIANT_ENFORCEMENT, checkConsentScope, createPathPlan } from './path-auth.mjs';
import { ReasoningRefused, reasoningStatus } from './reasoning.mjs';
import { ReasoningRouter, ReasoningUnavailable, routingFrom } from './reasoning-router.mjs';
import { researchGateFrom } from './research-gate.mjs';
import { runResearchReport, ResearchReportStore, RefusalRegistry } from './research.mjs';
import { OWNER_MODULE_CATALOG, OWNER_PUBLISHER_ID, OWNER_PUBLISHER_TRUST_LEVEL, findCatalogEntry } from './owner-module-catalog.mjs';
import { rescanNoesarEvolutionProjects, triageUnclassifiedFindings, triageFindingById, fetchAndScanRemoteTarget, probeApiTarget } from './debug-evolution-bridge.mjs';
import { RemoteTargetRegistry } from './remote-target-registry.mjs';
import { ApiTargetRegistry } from './api-target-registry.mjs';
import { keyscanHost, RemoteTargetFetchError } from './remote-target-fetch.mjs';
import { createModuleConsoleProxyServer } from './module-console-proxy.mjs';
import {
  TokenMinter, authorizePlan, capabilityStatus, CapabilityError,
} from './capability.mjs';
import { compare as compareShadow, shadowStatus, ShadowError } from './shadow.mjs';
import { executorStatus } from './executor.mjs';
import { resolveExecuteSandboxConfig } from './execute-sandbox-config.mjs';
import { detectSandboxSync } from './sandbox-runner.mjs';
import { EventLedger, eventsStatus } from './events.mjs';
import { buildRepositoryMap, literalSearch, repoMapStatus, RepoMapError } from './repo-map.mjs';
import { gitStatus } from './git-status.mjs';
import {
  SectorModuleError, loadSectorModules, sectorModulesStatus, validateCandidateManifest,
  installSectorModule, activateSectorModule, deactivateSectorModule, uninstallSectorModule,
  readInstalledManifest, classifyModuleRisk, signSectorModuleManifest,
} from './sector-modules.mjs';
import { moduleLifecycleStatus, isModuleActive, debugEvolutionToolSeeds, reconcileModuleTools } from './module-wiring.mjs';
import {
  CompliancePackError, loadCompliancePacks, compliancePacksStatus,
  validateCompliancePackDocument, checkPackDates, loadComplianceSchema,
} from './compliance-packs.mjs';
import {
  TechnologyRadarError, loadRadarSchema, loadRadarSeed, validateRadarEntry,
  checkRingTransition, loadTechnologyRadar, technologyRadarStatus,
} from './technology-radar.mjs';
import {
  ScimError, ScimTokenStore, mintScimToken, listScimTokens, revokeScimToken,
  authenticateScimToken, toScimUser, scimListResponse, scimServiceProviderConfig,
  scimError, applyScimPatch, scimStatus,
} from './scim.mjs';
import {
  OidcError, verifyIdToken, validateDiscoveryDocument, oidcStatus,
} from './oidc.mjs';
import {
  ToolCatalogError, loadToolCatalogSchema, validateToolEntry, searchCatalog,
  ActiveToolRegistry, toolCatalogStatus,
} from './tool-catalog.mjs';
// `/skills` — the sibling catalogue. Same discipline, different payload: a tool does
// something, a skill tells the agent HOW, so its danger is context load rather than effect.
import {
  SkillCatalogError, searchCatalog as searchSkillCatalogEntries,
  AdoptedSkillRegistry, skillCatalogStatus,
} from './skill-catalog.mjs';
import { WorkspaceActionOrchestrator, WorkspaceActionError, workspaceActionsStatus } from './workspace-actions.mjs';
import { Author, openAiChatGenerator, atomAuthoringGenerator, declaredFallbackGenerator } from './author.mjs';
import { profileChange } from './divergence-profile.mjs';
import { AdapterGrantOrchestrator, AdapterCapabilityError, adapterCapabilityStatus } from './adapter-capability.mjs';
import { evaluateEgress, privacyBanner, derivePrivacy } from './privacy.mjs';
import { JsonStore } from './store.mjs';
import { AtomicJsonStore } from './ai-workspace/atomic-store.mjs';
import { ContextGraph } from './ai-workspace/context-graph.mjs';
import { CredentialVault } from './ai-workspace/credential-vault.mjs';
import { ProviderGateway } from './ai-workspace/provider-gateway.mjs';
import { WorkspaceService } from './ai-workspace/workspace-service.mjs';
import { AgentService } from './ai-workspace/agent-service.mjs';
import { WorkflowService } from './ai-workspace/workflow-service.mjs';
import { ApprovalQueue } from './approval-queue.mjs';
import { MemoryService } from './memory-service.mjs';
import { compactRun } from './memory-compaction.mjs';
import { ClosureRegister, ProductMetric } from './product-metric.mjs';
import { ChatOrchestrator } from './ai-workspace/chat-orchestrator.mjs';
import { FileExtractor, extractorCapabilities } from './ai-workspace/file-extractors.mjs';
import { ToolExecutor } from './ai-workspace/tool-executor.mjs';
import { Logger } from './logging.mjs';
import { Metrics } from './metrics.mjs';
import { DebugMode } from './debug-mode.mjs';
import { Watchdog, watchdogStatePath } from './watchdog.mjs';
import { UpdateManager } from './update-manager.mjs';
import { PublisherRegistry, PublisherRegistryError } from './publisher-registry.mjs';
import { TimezoneService, formatInZone, toUtcIso } from './timezone.mjs';
import { buildHealth, buildReadiness, publicHealth, registerWatchdogSubjects } from './observability.mjs';
import { buildHomeOverview } from './home-overview.mjs';
import { resolveTls } from './tls.mjs';
import {
  resolveTrustAnchor, renderTrustAnchorIndex, TRUST_ANCHOR_BASENAME, TRUST_ANCHOR_CONTENT_TYPE,
} from './trust-anchor.mjs';
import { browserSignIn, shouldRedirectToSecure } from './secure-address.mjs';
import { createSessionDispatch, startUnixSocketServer, ProtocolError, bridgedMethodPermissions } from './session-protocol.mjs';
import { buildCodenAddressBook } from './coden-address-book.mjs';
// The SAME registry both shells resolve typing against. Imported here so the candidate list the
// model is allowed to choose from is built from this session's identity rather than proposed by
// whoever is calling — see `/api/v1/voice/interpret`. It imports nothing itself, so a server-side
// import of a file that also runs in the browser costs nothing and buys one list instead of two.
import { menuFor, accountFromUser } from '../../../apps/webui-static/agent-commands.js';
import { resolveCliDownload, readCliArtifact, renderCliIndex } from './cli-downloads.mjs';

const here = fileURLToPath(new URL('.', import.meta.url));
const repoRoot = resolve(here, '../../..');
const webRoot = resolve(repoRoot, 'apps/webui-static');
const workspace = resolve(process.env.NOESAR_WORKSPACE ?? join(repoRoot, '.workspace'));
// D-0277: found running a REAL install against a --read-only production-hardened
// container (the browser E2E probe, same hardening as the live installation) --
// defaulting these under repoRoot put them under /opt/noesar, which is the read-only
// image, not the writable volume. Every deploy so far set NOESAR_WORKSPACE but never
// NOESAR_SECTOR_MODULES/NOESAR_COMPLIANCE_PACKS, so this was live-broken from D-0274
// onward and nothing had ever actually tried to write to either path until this session.
// Defaulting under `workspace` (already correctly configured everywhere) means a client
// gets a working default without needing to remember a second, separate env var.
const sectorModulesRoot = resolve(process.env.NOESAR_SECTOR_MODULES ?? join(workspace, 'sector-modules'));
const compliancePacksRoot = resolve(process.env.NOESAR_COMPLIANCE_PACKS ?? join(workspace, 'compliance-packs'));
const technologyRadarRoot = resolve(process.env.NOESAR_TECHNOLOGY_RADAR ?? join(repoRoot, '.technology-radar'));
const toolCatalogRoot = resolve(process.env.NOESAR_TOOL_CATALOG ?? join(repoRoot, '.tool-catalog'));
const activeToolRegistry = new ActiveToolRegistry();
// A runtime location, never baked into the image — the same posture as `.tool-catalog`,
// `.sector-modules` and `.compliance-packs`.
const skillCatalogRoot = resolve(process.env.NOESAR_SKILL_CATALOG ?? join(repoRoot, '.skill-catalog'));
// ONE registry for the whole process. Both transports read this object; a second one would
// give the terminal its own adopted skills and make the at-rest number a per-shell opinion.
const adoptedSkillRegistry = new AdoptedSkillRegistry();
const port = Number(process.env.NOESAR_PORT ?? 8088);
const host = process.env.NOESAR_HOST ?? '127.0.0.1';
// A half-configured NOESAR_TLS_CERT_FILE/NOESAR_TLS_KEY_FILE pair throws here, at module
// load, and crashes startup the same way an invalid authority declaration does two lines
// below — fail closed and loudly, not a fallback to plaintext nobody asked for.
const tls = resolveTls({});
// The certificate a device must be told to trust, resolved once here and served at /ca.
// Unlike resolveTls this never throws: a certificate authority file that does not match is an
// operator mistake in a convenience route, and taking down a healthy TLS listener over it
// would be out of proportion. It is reported at start-up instead — see the `trust_anchor`
// field of the listening log line, which carries the fingerprint an operator must compare.
const trustAnchor = resolveTrustAnchor({ tls });
/**
 * An ADDITIONAL TLS listener, alongside the plain one — s336, and the reason is a browser rule
 * rather than a preference.
 *
 * `navigator.mediaDevices` does not exist outside a secure context, so a product served on
 * `http://192.168.178.100:8100` cannot open a microphone however well its voice engine is
 * configured. TLS is not a hardening exercise here; it is the thing that makes the feature exist.
 *
 * Why a SECOND listener instead of simply putting TLS on the main one, which this file has
 * supported since `D-0055`. Measured before touching anything, and both would have broken:
 *
 *   - Debug Evolution calls this control plane at `http://noesar-evolution:8088`, on the private
 *     container network, with a service token. Turning that port into TLS detaches the module
 *     unless its own trust store learns this installation's certificate — and that is another
 *     product's container, which this session may not reconfigure.
 *   - The module console proxy is reached by a browser and would have gone on serving plaintext
 *     while the cookies it depends on became `Secure`. Fixed in the same change.
 *
 * So: TLS faces the LAN, plaintext stays on the private network for the module that needs it and
 * is not published. Set `NOESAR_TLS_PORT` and the main port stays plain; leave it unset and the
 * historical behaviour is exactly what it was — the main listener becomes TLS.
 */
const tlsPort = Number(process.env.NOESAR_TLS_PORT ?? 0) || null;
const mainListenerIsTls = tls.active && !tlsPort;
// TLS active implies secure cookies: serving a non-Secure cookie over a connection this
// process itself just encrypted would be the misconfiguration this default exists to
// prevent. The environment variable can still force it true when TLS terminates in front
// of this process instead (a reverse proxy this product does not ship, D-0055) — it can
// never force it back to false while this process holds the private key.
const secureCookies = process.env.NOESAR_SECURE_COOKIES === 'true' || tls.active;
const authority = assertReferenceRuntimeAllowed(authorityStatus(process.env));

// The PostgreSQL data plane comes up asynchronously, so this starts as the declared
// configuration and is replaced by describeDataPlane() once the supervisor is ready —
// `let` rather than `const` for exactly that reason. In reference-json mode the original
// fail-closed assertion still runs here, at module load, unchanged.
const declaredDataPlane = dataPlaneStatus(process.env);
const postgresEnabled = declaredDataPlane.mode === DataPlaneMode.POSTGRESQL;
let dataPlane = postgresEnabled
  ? { ...declaredDataPlane, reason:'PostgreSQL is starting; readiness is withheld until it answers.' }
  : assertDevelopmentDataPlane(declaredDataPlane);
const allowedHosts = new Set(
  (process.env.NOESAR_ALLOWED_HOSTS ?? 'localhost,127.0.0.1,::1')
    .split(',').map((value) => value.trim().toLowerCase()).filter(Boolean)
);
if (host !== '0.0.0.0' && host !== '::') allowedHosts.add(host.toLowerCase());

// The address the operator published this container on, and the exposure scope that
// follows from it. Both are declarations: from inside the namespace the process only
// ever sees NOESAR_HOST (0.0.0.0), which is identical for a loopback publish and a
// LAN publish. Unset means loopback — an installation nobody configured is reachable
// locally and nowhere else.
//
// Declaring the publish address here rather than only in the installer keeps the Host
// allowlist and the publish from drifting apart: a LAN publish whose address is not in
// the allowlist answers 421 to every browser request, which looks like an outage.
const bindAddress = (process.env.NOESAR_BIND_ADDRESS ?? '').trim();
const exposureScope = resolveBindScope({ bindAddress, bindScope:process.env.NOESAR_BIND_SCOPE });
if (bindAddress && !isWildcardAddress(bindAddress)) allowedHosts.add(bindAddress.toLowerCase());

const ledger = new AuditLedger(join(workspace, 'audit/events.jsonl'));
// ARCH-008 / D-0250: the client's own decision for this installation, resolved once at boot,
// before the minter exists — the minter needs the real ceiling to enforce D-0248's mint-time
// widening check for EXECUTE grants (`exceedsCeiling`); constructing it with no ceiling would
// leave that check silently never firing, on any installation, whether EXECUTE is enabled or
// not. `detectSandboxSync` runs the binary's own `--detect` once, synchronously (module scope
// here has no event loop running yet to await into) — absence or a failed probe is `null`,
// never assumed.
const executeSandboxConfig = resolveExecuteSandboxConfig(process.env);
// Probed only when the operator actually asked for it — an installation that never set
// NOESAR_EXECUTE_SANDBOX=enabled must not have this process spawn anything at boot either,
// same rule local-model-runtime.mjs states for itself: nothing executes until configured.
const sandboxCeiling = executeSandboxConfig.enabled
  ? detectSandboxSync({ binaryPath: executeSandboxConfig.binaryPath })?.containerCeiling ?? null
  : null;
// The capability secret is generated per process and never written down: a token that
// outlived the engine that issued it would be a grant with no ledger behind it. The
// consequence -- a restart invalidates every outstanding token -- is reported by
// capabilityStatus rather than left to be discovered.
const capabilityMinter = new TokenMinter(randomBytes(32), { ceiling: sandboxCeiling });
// The engine causal record. DURABLE since D-0338: appended to a journal as each event is
// accepted, and rebuilt at startup by `loadFrom`, which hands the records to `restore()` and
// therefore recomputes every digest rather than trusting the ones on disk. It does not
// replace the product audit trail, which is a different question (who did what) with a
// different lifetime.
const engineEvents = EventLedger.loadFrom(join(workspace, 'state/engine-events.jsonl'));
// D-0190: the first product surface that spends a capability token and changes a real file.
// Shares the same minter and event ledger the phase-1 routes below already report — a
// second minter here would let a token minted through one door be unaccountable to the
// other.
//
// Runs are DURABLE since D-0338, and the sentence that used to stand here was the reason
// they were not: *"a restart that clears outstanding tokens must clear the runs that
// reference them, not leave a promoted run pointing at a token nobody can spend or verify
// any more."* Measured before changing it, and the premise does not hold — `token` is a
// LOCAL in `approve()`, minted and spent inside one call, and never stored on the run. What
// reaches a run is the event payload's `tokenId`, which is a name in the causal record, not
// a spendable grant. The token's lifetime is a function call; the run's is the operator's
// attention span, and tying the second to the first cost them their work on every restart.
//
// The shadow root is OUTSIDE the workspace on purpose, found by trying the wrong thing
// first: `join(workspace, 'shadows')` — the directory the read-only /api/v1/shadow status
// route already probes reflink support in — fails the moment a real whole-workspace shadow
// is built there, because shadow.mjs refuses a shadow that the workspace it shadows would
// itself contain ("the shadow and the workspace must not contain one another"). That route
// never materialises a real shadow, only probes a tiny file, so the containment check had
// never fired until this wiring tried to build one for real. `/tmp` is the container's other
// writable location (tmpfs, cleared on restart) and is never nested inside `/workspace`.
//
// Configurable since the reasoning provider became routable: `simulate` hands the provider a
// PATH, so a provider in another process predicts nothing unless it can read that directory.
// The default is unchanged, and nothing about the product changes when it is not set — but
// sharing the shadow root with a provider is now a mount, not an edit to this file.
const shadowsRoot = String(process.env.NOESAR_SHADOWS_ROOT ?? '').trim()
  || join(tmpdir(), 'noesar-workspace-action-shadows');
// `currentPrivacy` is a hoisted function declaration defined further below in this module;
// referencing it here is safe because it is only ever CALLED later, once plan()/approve() run
// — same pattern sessionDispatch below already relies on for getShadowSnapshot.
// Phase 6, THE ASSEMBLY POINT — the only place in this product where a fallback is chosen.
//
// Until now nothing here built an Author at all, so the installed product planned without ever
// writing a byte and said so. Both generation ports exist and neither may decide this on its
// own: `atomAuthoringGenerator` REFUSES when ATOM is unreachable (a port that quietly asked a
// model instead would be the silent fallback the router forbids), and `openAiChatGenerator`
// knows nothing about ATOM. The choice between them is a declaration, so it is made here,
// where the run, the ledger, the Session Proof and both status lines can be told.
//
// Three installations, three behaviours, none of them a surprise:
//
//   no model configured          the Author is absent; plan() says why, and writes nothing
//   a model, no ATOM             the model answers; THIS side applies all seven rules (CE-022)
//   a model and ATOM             the chain; and if ATOM falls, the model answers, DECLARED
function buildAuthor() {
  const modelEndpoint = String(process.env.NOESAR_AUTHORING_ENDPOINT ?? '').trim();
  const atomEndpoint = String(process.env.NOESAR_RUST_REASONING_ENDPOINT ?? '').trim();
  // No model underneath means there is nothing to author with and nothing to fall back to.
  // Absent beats a guess — the same posture `simulate` takes with `supported:false`.
  if (!modelEndpoint) return null;
  const model = openAiChatGenerator({ endpoint: modelEndpoint, model: process.env.NOESAR_AUTHORING_MODEL || null });
  if (!atomEndpoint) return new Author({ generate: model, model: modelEndpoint });
  const chain = declaredFallbackGenerator({
    primary: atomAuthoringGenerator({ endpoint: atomEndpoint, token: process.env.NOESAR_RUST_REASONING_TOKEN ?? '' }),
    fallback: model,
    // The run carries the record and the Session Proof records it; this line is for whoever is
    // WATCHING the installation rather than using it, to whom an API response is invisible.
    // `logger` is declared further down this module; this arrow only RUNS at plan() time, by
    // which point it is assigned — the same deferred-reference pattern `currentPrivacy` uses
    // twenty lines above, and the reason this is an arrow rather than a bound reference.
    onDegrade: (record) => logger.warn('authoring degraded to the reference model', {
      path: record.path, reason: record.reason, at: record.at,
    }),
  });
  return new Author({ generate: chain, model: `atom ${atomEndpoint} → ${modelEndpoint}` });
}
const workspaceActions = new WorkspaceActionOrchestrator({
  workspaceRoot: workspace, shadowsRoot,
  minter: capabilityMinter, events: engineEvents, executeSandbox: executeSandboxConfig,
  privacyStateFor: () => currentPrivacy(null),
  author: buildAuthor(),
  // `D-0345` — the wiring `/skills` declared missing about itself from the day it was built.
  // The registry holds bodies; this hands the Author the ones in scope, and nothing else in
  // the product reads `instructionsFor`. Resolved per call rather than captured once, so a
  // skill dropped mid-task is genuinely out of scope for the next plan.
  skillsFor: () => adoptedSkillRegistry.list().map((entry) => ({
    id: entry.id,
    name: entry.name,
    instructions: adoptedSkillRegistry.instructionsFor(entry.id),
  })).filter((skill) => typeof skill.instructions === 'string' && skill.instructions.length > 0),
  // Under `state/`, beside auth.json and ai-workspace.json, because that is already this
  // product's own state directory — not scattered into the tree the operator is editing.
  runStoreDirectory: join(workspace, 'state/runs'),
});
// F4-015: shadowStatus() probes the mount by writing and reflink-cloning a real file
// (probeCopyOnWrite in shadow.mjs) — correct for measuring truth rather than assuming it,
// wrong to run as a side effect of a GET. Probed once here, at startup, not per request;
// `GET /api/v1/shadow` serves this snapshot, and `POST /api/v1/shadow/reprobe` is the only
// path left that writes, because now it is the only path that says so in its verb.
let shadowSnapshot = shadowStatus(join(workspace, 'shadows'));
const store = new JsonStore(join(workspace, 'state/state.json'));
const aiStore = new AtomicJsonStore(join(workspace, 'state/ai-workspace.json'));
const contextGraph = new ContextGraph(aiStore);
const credentialVault = new CredentialVault({ keyPath:join(workspace, 'config/provider-credentials.key') });
const providerGateway = new ProviderGateway({ store:aiStore, vault:credentialVault, ledger });
providerGateway.ensureDefaults();
const fileExtractor = new FileExtractor({ blobRoot:join(workspace, 'files') });
const aiWorkspace = new WorkspaceService({ store:aiStore, graph:contextGraph, ledger, fileExtractor });
const toolExecutor = new ToolExecutor({ vault:credentialVault, ledger });
// UI-080…096 — ephemeral by design, see research.mjs's own module comment: a restart
// revoking every live report link is the declared behaviour, not a gap.
const researchReportStore = new ResearchReportStore();
const researchRefusalRegistry = new RefusalRegistry();
const agentService = new AgentService({ store:aiStore, ledger, executor:toolExecutor, vault:credentialVault });
// D-0286: the SAME vault every other credential in this product already uses -- one
// authentication, one encryption-at-rest key, not a second one to manage for SSH keys.
const remoteTargetRegistry = new RemoteTargetRegistry({ store:aiStore, vault:credentialVault, ledger });
// D-0292: and the same vault again for API credentials -- a third kind of secret, not a
// third place to keep one.
const apiTargetRegistry = new ApiTargetRegistry({ store:aiStore, vault:credentialVault, ledger });
const workflowService = new WorkflowService({ store:aiStore, ledger, executor:toolExecutor });
const chatOrchestrator = new ChatOrchestrator({ graph:contextGraph, workspace:aiWorkspace, providers:providerGateway, store:aiStore, ledger });
const hardware = discoverHardware();
// The bootstrap token is resolved from a 0600 runtime file, not from the
// environment: an environment variable is visible in `docker inspect` and in
// /proc/<pid>/environ. It is generated on first run and never logged in full.
const setupTokenState = resolveSetupToken({
  alreadyInitialized: new AuthStore(`${workspace}/state/auth.json`).read().initialized,
});
const auth = new AuthService({
  workspace,
  setupToken: setupTokenState.token,
  ledger,
  secureCookies,
});

// The session protocol (docs/CODEN_EVOLUTION_DESIGN_V1.md §17): one dispatch, closed over
// these exact instances, reached by two transports below — the unix socket (a real
// terminal) and the HTTP bridge (the WebUI's own Terminal tab). Neither transport
// constructs its own WorkspaceActionOrchestrator; a second instance would give the
// terminal a run history the workbench cannot see, which is the "second client with its
// own state" the design explicitly rejects.
const sessionDispatch = createSessionDispatch({
  // The SAME registry the HTTP routes above read, and the same catalogue root. Two shells,
  // one surface: that is §4b.4 rule 4, made structural instead of asserted.
  skillCatalogStatus: () => skillCatalogStatus(adoptedSkillRegistry),
  searchSkillCatalog: (query) => searchSkillCatalogEntries(repoRoot, skillCatalogRoot, query),
  workspaceActions, buildRepositoryMap, literalSearch, resolveWorkspaceSubpath,
  workspaceRoot: workspace, engineEvents, workspaceActionsStatus,
  getShadowSnapshot: () => shadowSnapshot, capabilityStatus, capabilityMinter,
  contextGraph, ledger, invariantEnforcement: INVARIANT_ENFORCEMENT,
  // Phase 4: the address list a terminal shell is told about, derived from the very file
  // this process serves the browser out of — one list, two shells. Passed as a function so
  // it is read when a shell asks rather than once at boot: a redeploy that swaps the static
  // directory under a surviving process would otherwise keep answering for the old one.
  codenAddressBook: () => buildCodenAddressBook(webRoot),
  // The same reader `GET /api/v1/coden/git-status` uses, against the same root: the terminal's
  // `remote` field and the browser's `git` chip are one fact, read once, not two readings that
  // could disagree about the same repository.
  gitStatus,
  // Phase 3b: the SAME objects the HTTP routes for these already use, so the terminal's bench
  // lists and the browser's are one snapshot, and the closure register is one register.
  // `closureRegister` arrives as a thunk because it is constructed further down this file,
  // after this dispatch — reading the binding directly here would read it uninitialised.
  aiWorkspace,
  getClosureRegister: () => closureRegister,
});

// --- data plane and multi-user directory -------------------------------------
// ARCH-001: under noesar-supervisord (rust/crates/noesar-supervisor) postgres is a real
// peer OS process (bin/postgres-child.mjs owns it), and this process must not spawn a
// second postmaster against the same data directory. NOESAR_POSTGRES_PEER_MODE is set by
// that supervisor's child table, never by a human; its absence (every deployment that
// predates this phase, and every existing test) preserves today's exact behaviour.
const postgres = postgresEnabled
  ? new PostgresSupervisor({
    root: process.env.NOESAR_POSTGRES_ROOT ?? join(workspace, 'postgresql'),
    secretsDir: join(workspace, 'config/postgres'),
    managesProcess: process.env.NOESAR_POSTGRES_PEER_MODE !== '1',
  })
  : null;
// A function, not the supervisor itself: the directory is constructed now and the
// database becomes available later, so capturing the value here would capture `null`.
const userDirectory = new UserDirectory({ auth, ledger, dataPlane: () => postgres });
// 14_MEMORIA_A_CUBI.md, D-0261/D-0262/D-0263: same "a function, not the supervisor
// itself" reasoning as userDirectory above.
const memoryService = new MemoryService({ dataPlane: () => postgres });
// §4: "la compattazione è automatica — a fine sessione, senza chiedere." A finished
// workspace-actions run (approved or rejected — both are a decided outcome, §3.1's nine
// categories include both `decisione` shapes) is compacted right after the response is
// already being written, never blocking or failing the decision itself: memory is a
// side-effect of the run, not a precondition for it. Errors are logged, not thrown — a
// Postgres outage must not turn an otherwise-successful approve/reject into a 500.
function compactRunAfterDecision(runId) {
  compactRun({ ledger: engineEvents, memoryService }, { runId, projectId: null })
    .then((result) => {
      if (result.written.length > 0) {
        logger.info('memory.compacted', { component: 'memory', runId, written: result.written.length, skipped: result.skipped });
      }
    })
    .catch((error) => {
      logger.error('memory.compaction-failed', { component: 'memory', runId, error: error.message });
    });
}
const scimTokenStore = new ScimTokenStore(join(workspace, 'state/scim-tokens.json'));
// ARCH-005: the same minter and event ledger workspace-actions shares above — a second
// engine here would let a token minted through one door be unaccountable to the other.
const adapterGrants = new AdapterGrantOrchestrator({ minter: capabilityMinter, events: engineEvents });
const localModels = new LocalModelRuntime({ workspace, minter: capabilityMinter });

// The privacy indicator is DERIVED, never stored — 01_PRODUCT/12.
//
// This used to be `let currentPrivacyState = PrivacyState.LOCAL_ONLY_VERIFIED`, assigned
// at module load and then overwritten by whatever egress plan any authenticated caller
// last evaluated. Two defects followed from that one line. It asserted "verified" before
// anything had been verified; and a caller asking what *would* happen if they used a
// remote model left the whole installation reporting REMOTE_MODEL_ACTIVE — on the strength
// of a plan that had just been refused. Deriving the state from enabled providers and
// consented connectors leaves nothing for a caller to set and nothing to go stale across
// a restart.
//
// The one part of this that genuinely is an event rather than configuration is a refusal,
// so that is the only piece kept here — and it is fed by the provider gateway when a real
// attempt to reach an external destination is stopped, never by an egress *plan*, which is
// only a question. Without this wiring POLICY_VIOLATION_BLOCKED would be a state the pure
// function can produce and the running product never reaches: a named state with no
// producer, which is the decoration this phase set out to remove.
let lastPolicyViolation = null;
providerGateway.onEgressBlocked = (violation) => { lastPolicyViolation = violation; };

// A blocked attempt is news for a while and then it is history. The audit ledger is the
// permanent record; the indicator describes the situation now. With no window, a single
// refusal would pin the banner to POLICY_VIOLATION_BLOCKED indefinitely — the same
// always-on alarm `D-0088` removed from the pending state.
const VIOLATION_VISIBLE_MS = 15 * 60 * 1000;
function recentViolation() {
  if (!lastPolicyViolation) return null;
  const age = Date.now() - Date.parse(lastPolicyViolation.at);
  if (!Number.isFinite(age) || age > VIOLATION_VISIBLE_MS) return null;
  return lastPolicyViolation;
}

function currentPrivacy(user = null) {
  try {
    const state = aiStore.read();
    return derivePrivacy({
      observed: true,
      providers: state.providerProfiles ?? [],
      tools: state.tools ?? [],
      retentionDays: state.settings?.retentionDays,
      lastViolation: recentViolation(),
      // Answered by the same check the revoke route enforces, so the disclosure cannot
      // advertise a control this particular caller would be refused.
      ...(user ? { canRevoke: auth.hasPermission(user, 'provider.manage') } : {}),
    });
  } catch {
    // The configuration could not be read, so no guarantee can be made in either
    // direction. Reporting LOCAL_ONLY_VERIFIED here would be the original defect again.
    return derivePrivacy({ observed: false });
  }
}

const PRODUCT = Object.freeze({ name:'NOESAR Evolution', version:'1.0.0-complete-ai-workspace', releaseVersion:'0.6.0' });

// --- observability, recovery and update subsystems ---------------------------
const logger = new Logger({
  dir: join(workspace, 'logs'),
  level: process.env.NOESAR_LOG_LEVEL ?? 'INFO',
  component: 'control-plane',
  maxFileBytes: Number(process.env.NOESAR_LOG_MAX_FILE_BYTES ?? 64 * 1024 * 1024),
  keepFiles: Number(process.env.NOESAR_LOG_KEEP_FILES ?? 14),
  quotaBytes: Number(process.env.NOESAR_LOG_QUOTA_BYTES ?? 2 * 1024 * 1024 * 1024),
});
const metrics = new Metrics({ buildInfo:{ version:PRODUCT.releaseVersion, channel:process.env.NOESAR_RELEASE_CHANNEL ?? 'complete', data_plane:dataPlane.mode ?? 'reference-json' } });
const debugMode = new DebugMode({ logger, ledger });
const timezoneService = new TimezoneService({ store, ledger, logger });
const watchdog = new Watchdog({
  logger, ledger, metrics,
  statePath: watchdogStatePath(workspace),
  notify: (payload) => ledger.append({ actor:'system', action:'owner.notification', result:'raised', details:payload }),
});
const updateManager = new UpdateManager({
  root: join(workspace, 'updates'),
  currentVersion: PRODUCT.releaseVersion,
  ledger, logger, metrics, watchdog,
  backup: async ({ fromVersion, toVersion }) => {
    // The reference data plane is file-backed JSON with no snapshot isolation, so
    // the backup is a verified copy, not a live snapshot.
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const target = join(workspace, 'backups', `pre-update-${fromVersion}-to-${toVersion}-${stamp}`);
    mkdirSync(target, { recursive:true, mode:0o700 });
    const sources = ['state', 'config', 'audit'];
    for (const name of sources) {
      const from = join(workspace, name);
      if (existsSync(from)) cpSync(from, join(target, name), { recursive:true });
    }
    // A backup is only real once it has been checked: every source directory that
    // existed must exist in the copy, or the update does not proceed.
    const verified = sources.every((name) => !existsSync(join(workspace, name)) || existsSync(join(target, name)));
    writeFileSync(join(target, 'BACKUP.json'), JSON.stringify({ fromVersion, toVersion, createdAt:toUtcIso(), sources, verified }, null, 2), { mode:0o600 });
    return {
      id: target,
      verified,
      restore: async () => {
        for (const name of sources) {
          const from = join(target, name);
          if (existsSync(from)) cpSync(from, join(workspace, name), { recursive:true, force:true });
        }
      },
    };
  },
  healthCheck: async () => !watchdog.safeMode.active,
});
// D-0275: the trusted publisher registry sector-modules.mjs's activateSectorModule()
// consults for a high-risk manifest's signing key -- see publisher-registry.mjs.

// ── The model catalogue's three server-only facts · s333 point 5 ─────────────────────────
//
// `model-catalog.mjs` never imports `node:fs`, and MC-005 is a test on its import list rather
// than a count taken at one moment. That only stays true if the disk is read HERE.
//
// A descriptor is DECLARED by a publisher — this product does not write one on a publisher's
// behalf and does not infer its fields. Descriptors live in the workspace so that an operator
// can place them without a rebuild, which is also how a future transport will deliver them.
const MODEL_CATALOG_DIR = join(workspace, 'models', 'catalog');
const MODEL_ARTEFACT_DIR = join(workspace, 'models', 'artefacts');
// The ceiling written into the acquisition grant. A model is large; a grant with no ceiling is
// not a grant, it is permission to fill the disk.
const MODEL_ACQUIRE_MAX_BYTES = 64 * 1024 * 1024 * 1024;

// ── The one answer to "which model is loaded" — Owner, s335 ─────────────────────────────────
//
// Everything the catalogue needs for the `in-use` lane was already built; what it had was a
// source that is `null` whenever the LOCAL runtime is disabled, which is the default. So an
// installation with a model resident and answering both the Author and ATOM reported no model
// in use at all. This snapshot is the truthful source, and the SAME object answers
// `/api/v1/models/active`, so a module and the page an operator is reading cannot disagree.
//
// Held as a snapshot rather than probed per request for one reason worth writing down: the
// catalogue route is a page render, and a page must not wait on a third party. A stale answer
// carries `at`; a hanging page carries nothing.
let activeModelSnapshot = {
  state: ActiveModelState.NOT_CONFIGURED, source: null, id: null, served: null,
  endpoint: null, reason: 'not resolved yet', at: new Date(0).toISOString(),
};
let activeModelRefreshing = null;
const ACTIVE_MODEL_TTL_MS = 15_000;
// Who consumes the model on THIS installation, read from how it is actually wired rather than
// asserted: a module told "ATOM uses it" on an installation without ATOM would be told a lie.
function activeModelConsumers() {
  const consumers = [];
  if (String(process.env.NOESAR_AUTHORING_ENDPOINT ?? '').trim()) consumers.push('noesar-authoring');
  if (String(process.env.NOESAR_RUST_REASONING_ENDPOINT ?? '').trim()) consumers.push('atom');
  return consumers;
}
async function refreshActiveModel({ force = false } = {}) {
  const age = Date.now() - Date.parse(activeModelSnapshot.at || 0);
  if (!force && Number.isFinite(age) && age < ACTIVE_MODEL_TTL_MS) return activeModelSnapshot;
  // One refresh in flight at a time. Without this, a page opened in three tabs makes three
  // probes of a model server that is busy generating.
  if (activeModelRefreshing) return activeModelRefreshing;
  activeModelRefreshing = resolveActiveModel({
    localRuntimeModel: localModels.config().model ?? null,
    endpoint: String(process.env.NOESAR_AUTHORING_ENDPOINT ?? '').trim() || null,
    fetchImpl: typeof fetch === 'function' ? fetch : undefined,
  }).then((resolved) => {
    activeModelSnapshot = resolved;
    return resolved;
  }).catch(() => activeModelSnapshot).finally(() => { activeModelRefreshing = null; });
  return activeModelRefreshing;
}
/** The id the catalogue keys on, from whichever source spoke. Never a guess: `null` if neither. */
function activeModelId() {
  return localModels.config().model ?? (activeModelSnapshot.state === ActiveModelState.LOADED ? activeModelSnapshot.id : null);
}

function readModelDescriptors() {
  const descriptors = [];
  try {
    for (const name of readdirSync(MODEL_CATALOG_DIR)) {
      if (!name.endsWith('.json')) continue;
      try {
        const parsed = JSON.parse(readFileSync(join(MODEL_CATALOG_DIR, name), 'utf8'));
        if (parsed?.id) descriptors.push(parsed);
      } catch { /* a malformed descriptor is skipped, never guessed at */ }
    }
  } catch { /* no catalogue directory yet: an empty catalogue is a true answer */ }

  // The model actually running must appear even when no publisher has described it — MC-002
  // says the in-use model is visible under every filter, and a model absent from the catalogue
  // is hidden by ALL of them at once. It is synthesised with its id and NOTHING else, so every
  // other field reads `undeclared`: that is the honest statement, and inventing a type here to
  // make the card look complete is precisely what MC-003 forbids.
  // s335: `activeModelId()` and not `localModels.config().model` — the local runtime is one of
  // two sources and is disabled by default, so keying MC-002 on it alone hid every model this
  // installation did not start itself, which on a sidecar installation is all of them.
  const running = activeModelId();
  if (running && !descriptors.some((entry) => entry.id === running)) {
    descriptors.push({ id: running, workloads: [], hashes: {}, formats: [], resource_profiles: [] });
  }
  return descriptors;
}

// Which artefacts are on disk, and whether each matches the digest its publisher declared.
// `verified:false` is not an error state to be hidden — it is the `unverified` lane, and
// nothing starts from there (MC-004).
function readPresentModels(descriptors) {
  const present = new Map();
  for (const descriptor of descriptors) {
    const file = join(MODEL_ARTEFACT_DIR, `${descriptor.id}.bin`);
    let stat = null;
    try { stat = statSync(file); } catch { stat = null; }
    if (!stat?.isFile?.()) {
      // The configured model is running from somewhere this product did not put it — a
      // sidecar, a mounted volume, an endpoint. It is in use, which is a fact; claiming a
      // verified local artefact for it would not be.
      if (descriptor.id === activeModelId()) present.set(descriptor.id, { verified: true, external: true });
      continue;
    }
    const expected = descriptor.hashes?.sha256 ?? null;
    if (!expected) { present.set(descriptor.id, { verified: false }); continue; }
    try {
      const digest = createHash('sha256').update(readFileSync(file)).digest('hex');
      present.set(descriptor.id, { verified: digest === String(expected).toLowerCase() });
    } catch { present.set(descriptor.id, { verified: false }); }
  }
  return present;
}

const publisherRegistry = new PublisherRegistry({ root: join(workspace, 'publishers'), ledger });

// D-0277: "moduli owner" (a fixed NOESAR-built catalog, OWNER_MODULE_CATALOG) get a
// one-click Install/Activate instead of asking the Owner to drive the register/sign/mint
// sequence by hand. The signing key is generated ONCE and held server-side -- same
// load-or-create idiom auth.mjs already uses for auth-master.key -- because NOESAR itself
// is the publisher for its own catalog, not a third party the Owner has to hand a key to.
const ownerSigningKeyPath = join(workspace, 'publishers', 'noesar-signing-key.pem');
function loadOrCreateOwnerSigningKey() {
  if (existsSync(ownerSigningKeyPath)) return readFileSync(ownerSigningKeyPath, 'utf8');
  mkdirSync(join(workspace, 'publishers'), { recursive: true, mode: 0o700 });
  const { privateKey } = generateKeyPairSync('ed25519');
  const pem = privateKey.export({ type: 'pkcs8', format: 'pem' });
  writeFileSync(ownerSigningKeyPath, pem, { mode: 0o600 });
  return pem;
}
/** Idempotent: registers the `noesar` publisher's key the first time any catalog module
 * is installed, reuses it on every call after. Returns the private key PEM so the caller
 * can sign with it in the same request. */
function ensureOwnerPublisherRegistered({ actorId, nowUnix }) {
  const privateKeyPem = loadOrCreateOwnerSigningKey();
  const publicKeyPem = createPublicKey(createPrivateKey(privateKeyPem)).export({ type: 'spki', format: 'pem' });
  const alreadyRegistered = publisherRegistry.status().publishers
    .some((publisher) => publisher.publisherId === OWNER_PUBLISHER_ID && publisher.keys.some((key) => key.state === 'active'));
  if (!alreadyRegistered) {
    try {
      publisherRegistry.registerKey({ publisherId: OWNER_PUBLISHER_ID, trustLevel: OWNER_PUBLISHER_TRUST_LEVEL, publicKeyPem, actorId, nowUnix });
    } catch (error) {
      // The key file survives an intentional revoke of the registry entry (revoking
      // trust in a key is not the same act as destroying it). Re-registering the SAME
      // fingerprint after a revoke is refused as KEY_ALREADY_REGISTERED -- correct to
      // ignore here: activation still checks the registry's state, so a revoked key
      // stays refused, this call just avoids crashing on a key that is merely inactive.
      if (!(error instanceof PublisherRegistryError && error.kind === 'KEY_ALREADY_REGISTERED')) throw error;
    }
  }
  return privateKeyPem;
}

// D-0278: Debug Evolution as a real tool, not a sidebar bookmark — Owner instruction,
// verbatim: "devi collegarlo a tutto noesar". Agents and Workflows are the ONE tool
// system this reference implementation actually has (chat has no autonomous
// tool-calling loop for any tool, not only this one — POST .../messages is a message
// store, not an LLM function-calling engine); registering these here makes Debug
// Evolution's real data selectable as a step in either destination, the same as any
// other tool. Only if NOESAR_DEBUG_EVOLUTION_TOKEN is configured — declared, not
// silently skipped, when it is absent (a fresh install with the module not yet
// installed has nothing to seed a credential for).
//
// D-0281: dedup was by name only, so a tool already seeded kept its ORIGINAL endpoint
// forever, even across a boot with a different NOESAR_DEBUG_EVOLUTION_URL -- the network
// migration that moved Debug Evolution off the LAN found this the hard way: three tools
// still pointed at the old published port after it was closed. Reconcile on every boot
// instead of skipping.
//
// D-0283: reconcile in BOTH directions, and off the module's install state rather than off
// the environment. The environment says where the module is; `sector-modules/<id>/state.json`
// says whether NOESAR talks to it at all. Before this, uninstalling the module left three
// working, credentialled tools behind on every boot -- Owner instruction (s302), verbatim:
// "disinstallare debug evolution deve lasciare noesar intatto".
const DEBUG_EVOLUTION_MODULE_ID = 'debug-evolution';
function reconcileDebugEvolutionTools() {
  const token = process.env.NOESAR_DEBUG_EVOLUTION_TOKEN ?? null;
  const active = isModuleActive(sectorModulesRoot, DEBUG_EVOLUTION_MODULE_ID);
  const baseUrl = process.env.NOESAR_DEBUG_EVOLUTION_URL ?? 'http://192.168.178.100:8787';
  const summary = reconcileModuleTools({
    active, token, seeds: debugEvolutionToolSeeds(baseUrl), store: aiStore, agentService,
  });
  if (active && !token) logger.warn('debug_evolution.tools_not_seeded', { reason: 'NOESAR_DEBUG_EVOLUTION_TOKEN not configured' });
  if (summary.attached.length || summary.reconciled.length || summary.detached.length) {
    logger.info('module_wiring.tools_reconciled', {
      module: DEBUG_EVOLUTION_MODULE_ID, active,
      attached: summary.attached.length, reconciled: summary.reconciled.length, detached: summary.detached.length,
    });
  }
  return summary;
}

// D-0280: one authentication in the system, and it is NOESAR's.
//
// Owner instruction, verbatim: "no devi eliminarli password e token devi usare quelli di
// noesar e un modulo ora". An official module that calls back into this control plane must
// not require its own credential, and must not require the Owner to type a password into a
// minting tool to get one -- the same objection that produced the one-click catalog in
// D-0277. So NOESAR issues it, to itself, at boot.
//
// Load-or-create, deliberately the same idiom as loadOrCreateOwnerSigningKey() above: the
// token is readable exactly once, at issue, so the FILE is the source of truth. Every later
// boot re-verifies it still authenticates and reissues only if it does not -- which covers
// the operator revoking it without covering up the revocation, because a revoked token
// produces a new account-scoped token, never a silent escalation.
//
// The credential is written where the module can read it and nowhere else. It is never an
// environment variable on this side and never crosses the network from here.
//
// D-0283: provisioned for a module that is INSTALLED here, and taken away when it is not.
// A credential that outlives the module it was minted for is exactly the residue an
// uninstall is supposed to remove -- `disableUser` revokes every live token of the account
// in one write (user-directory.mjs), so the file left on disk stops authenticating rather
// than being deleted (rule 12), and a re-install reinstates the account and mints a fresh
// token through the same load-or-create path.
// D-0290: `gid` is the Unix group the module's container runs with, and it is what makes the
// token readable to a module that is NOT this process's user. It used to be: Debug Evolution
// ran as uid 10001, the same uid as this control plane, so a 0600 file was readable by it for
// the wrong reason -- there was no boundary, only a shared identity. The module now has its
// own uid (10010) and carries 10001 as a supplementary group solely to open this one file.
//
// The group, not a chown: this process runs non-root and cannot give a file away to another
// uid. Writing 0640 with the directory at 0710 is the part it CAN do, and it is enough --
// the module opens its token by exact path and cannot list the directory to discover anyone
// else's. When a second module exists, give each its own gid here; the mode bits already
// assume per-module groups and need no further change.
const MODULE_ACCOUNTS = [{ id: 'debug-evolution', displayName: 'Debug Evolution module', gid: 10001 }];
const moduleCredentialsRoot = join(workspace, 'module-credentials');

function activeOwnerAccount() {
  return userDirectory.list().find((user) => user.role === 'owner' && (user.status ?? 'active') === 'active') ?? null;
}

/** D-0290: make one module's token readable by that module's group, and by nobody else.
 *
 * Both halves are things a non-root process can do: `chmod` on a file it owns, and `chgrp`
 * to a group it belongs to. Giving the file to another UID is not, which is why the module
 * carries a supplementary group instead of owning its credential. A failure here is logged
 * and not thrown -- the token is still valid and NOESAR still works; what breaks is the
 * module's ability to read it, and a warning naming the file is more use at 3am than a
 * control plane that refuses to finish starting. */
function grantTokenToModule(path, module) {
  if (!module.gid) return;
  try {
    chownSync(path, -1, module.gid);
    chmodSync(path, 0o640);
  } catch (error) {
    logger.warn('module_credentials.grant_failed', { module: module.id, path, gid: module.gid, reason: error?.message ?? String(error) });
  }
}

function ensureModuleServiceAccounts() {
  const owner = activeOwnerAccount();
  if (!owner) {
    // A fresh installation with setup not yet completed. Declared, not silently skipped.
    logger.warn('module_credentials.not_provisioned', { reason: 'no active owner account yet' });
    return;
  }
  // 0710, not 0700: the module's group needs to TRAVERSE this directory to open its own token
  // by exact path. It deliberately gets no read bit, so it cannot list what else is in here --
  // traversal is not enumeration. `mkdirSync` does not reapply the mode to a directory that
  // already exists, so the mode is set explicitly below for installations created before this.
  mkdirSync(moduleCredentialsRoot, { recursive: true, mode: 0o710 });
  try { chmodSync(moduleCredentialsRoot, 0o710); } catch (error) {
    logger.warn('module_credentials.dir_mode_unchanged', { reason: error?.message ?? String(error) });
  }
  for (const module of MODULE_ACCOUNTS) {
    // Not installed (never, or no longer) -> no credential. The token file may still exist
    // from a previous installation; it does not authenticate while the account is disabled.
    if (moduleLifecycleStatus(sectorModulesRoot, module.id) === 'not-installed') continue;
    if (moduleLifecycleStatus(sectorModulesRoot, module.id) === 'uninstalled') { revokeModuleServiceCredential(module.id); continue; }
    const path = join(moduleCredentialsRoot, `${module.id}.token`);
    let account = userDirectory.list().find((user) => user.username === module.id);
    if (account && (account.status ?? 'active') !== 'active') {
      userDirectory.reinstateUser({ actorId: owner.id, userId: account.id });
      account = userDirectory.list().find((user) => user.username === module.id);
      logger.info('module_credentials.account_reinstated', { module: module.id });
    }
    if (existsSync(path)) {
      const existing = readFileSync(path, 'utf8').trim();
      // Applied on the already-valid path too, not only after a write: an installation that
      // predates D-0290 has a 0600 token that still authenticates perfectly, and returning
      // early would leave the module unable to open the file it is meant to authenticate with.
      if (existing && userDirectory.authenticateServiceToken(existing)) { grantTokenToModule(path, module); continue; }
      logger.warn('module_credentials.reissuing', { module: module.id, reason: 'stored token no longer authenticates' });
    }
    const issued = account
      ? userDirectory.issueServiceToken({ actorId: owner.id, userId: account.id, name: 'module' })
      : userDirectory.createServiceAccount({ actorId: owner.id, username: module.id, displayName: module.displayName });
    writeFileSync(path, issued.token, { mode: 0o640 });
    grantTokenToModule(path, module);
    logger.info('module_credentials.provisioned', { module: module.id, tokenId: issued.tokenId });
  }
}

/** Uninstall's half of the pair above. Idempotent: a module that never had an account, or
 * whose account is already disabled, is a no-op, not an error. */
function revokeModuleServiceCredential(moduleId) {
  const owner = activeOwnerAccount();
  const account = userDirectory.list().find((user) => user.username === moduleId && user.role === 'service_account');
  if (!owner || !account || (account.status ?? 'active') !== 'active') return false;
  userDirectory.disableUser({ actorId: owner.id, userId: account.id, reason: 'module uninstalled' });
  logger.info('module_credentials.revoked', { module: moduleId });
  return true;
}
// Called from reconcileModuleWiring() below, with the tools and the console proxy, so the
// three surfaces are provisioned and torn down together and never from three places.

// D-0281 follow-up: the module's own `externalUrl` (owner-module-catalog.mjs) stopped
// being reachable from a browser on the LAN the moment that phase closed the module's
// direct LAN exposure -- the module has no login of its own (D-0280) to protect it if
// it stayed reachable directly. This is the replacement path: a second listener, gated
// on the SAME session cookie every other NOESAR route checks, root-path proxying to the
// module over the internal network so its absolute-path assets resolve unmodified.
// Only started when there is a URL to proxy to; a fresh install with the module not
// configured gets nothing listening on the port, not a proxy to nowhere.
//
// D-0283: and only while the module is ACTIVE. A listener that keeps proxying a browser
// into an uninstalled module's console is the same residue as the tools and the credential
// -- so the port opens on activate and closes on deactivate/uninstall, instead of being
// decided once at boot by the presence of an environment variable.
const moduleConsoleProxyPort = Number(process.env.NOESAR_MODULE_PROXY_PORT ?? 8089);
const moduleConsoleProxyConfigured = Boolean(process.env.NOESAR_DEBUG_EVOLUTION_URL);
let moduleConsoleProxyServer = null;
let moduleConsoleProxyListening = false;

function ensureModuleConsoleProxyServer() {
  if (moduleConsoleProxyServer || !moduleConsoleProxyConfigured) return moduleConsoleProxyServer;
  moduleConsoleProxyServer = createModuleConsoleProxyServer({
    targetBaseUrl: process.env.NOESAR_DEBUG_EVOLUTION_URL,
    // D-0291: where `/noesar-api/...` goes back to. Loopback, not the LAN address: this is
    // this same process answering itself, and it must not depend on how NOESAR is published.
    noesarBaseUrl: `${mainListenerIsTls ? 'https' : 'http'}://127.0.0.1:${port}`,
    moduleName: 'Debug Evolution',
    // The browser reaches THIS listener, so its scheme follows the main one — see the factory's
    // own comment for what happens if it does not.
    tls: tls.active ? { cert: tls.cert, key: tls.key } : null,
    isAuthorized: (req) => {
      const session = optionalSession(req);
      return Boolean(session && auth.hasPermission(session.user, 'workspace.read'));
    },
  });
  return moduleConsoleProxyServer;
}

/** Idempotent. Returns whether the proxy is listening after the call, so a caller can log
 * the truth rather than its intention. */
function startModuleConsoleProxy() {
  if (!moduleConsoleProxyConfigured || !isModuleActive(sectorModulesRoot, DEBUG_EVOLUTION_MODULE_ID)) return false;
  const proxy = ensureModuleConsoleProxyServer();
  if (!proxy || moduleConsoleProxyListening) return moduleConsoleProxyListening;
  moduleConsoleProxyListening = true;
  proxy.listen(moduleConsoleProxyPort, host, () => {
    logger.info('module-console-proxy.started', { component:'control-plane', port:moduleConsoleProxyPort, target:process.env.NOESAR_DEBUG_EVOLUTION_URL });
  });
  proxy.on('error', (error) => {
    moduleConsoleProxyListening = false;
    logger.error('module-console-proxy.failed', { component:'control-plane', port:moduleConsoleProxyPort, error:error.message });
  });
  return true;
}

function stopModuleConsoleProxy() {
  if (!moduleConsoleProxyServer || !moduleConsoleProxyListening) return false;
  moduleConsoleProxyListening = false;
  moduleConsoleProxyServer.close(() => logger.info('module-console-proxy.stopped', { component:'control-plane', port:moduleConsoleProxyPort }));
  // A closed http.Server cannot listen again; the next activate builds a fresh one.
  moduleConsoleProxyServer = null;
  return true;
}

/**
 * The one call every module lifecycle transition makes — install, activate, deactivate,
 * uninstall, and boot. Each of the three surfaces (tools, credential, console proxy) reads
 * the SAME install state, so they cannot disagree about whether the module is wired in.
 * `listen` is false at import time (a test importing this module gets no open port, the
 * same guard the main HTTP listener has); the entrypoint calls it again with `listen`.
 */
function reconcileModuleWiring({ listen = false } = {}) {
  const tools = reconcileDebugEvolutionTools();
  ensureModuleServiceAccounts();
  const active = isModuleActive(sectorModulesRoot, DEBUG_EVOLUTION_MODULE_ID);
  if (!active) stopModuleConsoleProxy();
  else if (listen) startModuleConsoleProxy();
  return { active, tools, proxyListening: moduleConsoleProxyListening };
}
reconcileModuleWiring();

// The approval queue reads the three subsystems that own approvals and owns none itself,
// so it is constructed last — after the update manager it reads from.
const approvalQueue = new ApprovalQueue({ workflowService, agentService, aiStore, updateManager, ledger, memoryService });
// The product's own metric and the closure register. Both read and write the AI store, so
// they are constructed with it and with nothing else: the metric has no opinion about who
// decided, and the closure register has no opinion about what a run is.
const productMetric = new ProductMetric({ store:aiStore });
const closureRegister = new ClosureRegister({ store:aiStore, ledger });
registerWatchdogSubjects(watchdog, {
  workspace, webRoot, dataStore:aiStore, auditLedger:ledger, logger,
  providerGateway, updateManager, agentService, toolExecutor, hardware,
});
metrics.setGauge('noesar_safe_mode', 0);
metrics.setGauge('noesar_data_plane_up', 1);

// Routes that stay available while the runtime is degraded. Everything else that
// mutates is refused in safe mode: the point of safe mode is to preserve
// evidence, not to keep working badly.
const SAFE_MODE_WRITE_ALLOWLIST = new Set([
  '/api/v1/auth/login', '/api/v1/auth/login/mfa', '/api/v1/auth/login/passkey/options',
  '/api/v1/auth/login/passkey', '/api/v1/auth/logout', '/api/v1/auth/reauth',
  // A login path, in the same class as the four above: safe mode exists to stop the product
  // working badly, not to lock the operator out of the terminal they need in order to look.
  '/api/v1/auth/attach-code',
  '/api/v1/debug/enable', '/api/v1/debug/disable',
  '/api/v1/watchdog/safe-mode/leave', '/api/v1/updates/rollback',
]);

// The session protocol's HTTP bridge (/api/v1/tui/command) is one route for every method,
// so the permission each method needs cannot come from the route — it has to be looked up
// here, by name, matching exactly what the dedicated route for that same operation already
// enforces above. `null` means session-only, same as GET /api/v1/workspace-actions/:id and
// GET /api/v1/events/:id. A method absent from this table is refused as unknown, not run
// with no permission check — the fallback for "not listed" must be REFUSE, never ALLOW.
//
// Derived from session-protocol.mjs's own SESSION_METHOD_POLICY since `D-0302`, rather than
// written out here. It used to be the only copy, and the unix socket transport — the other
// shell onto the same dispatch — enforced nothing at all; the two agreed only because every
// role holds the two permissions this table names (measured in `D-0301`). One table, enforced
// inside the dispatch, means a method cannot be gated on one shell and open on the other.
const TUI_METHOD_PERMISSION = bridgedMethodPermissions();

function clientIp(req) { return req.socket.remoteAddress ?? 'unknown'; }

// WebAuthn's RP ID is a bare hostname, never scheme or port — and unlike a fixed
// product, NOESAR EVOLUTION is self-hosted under whatever host the Owner reaches it
// on, so it is read from the SAME request the ceremony belongs to rather than a
// config constant. `origin` reuses the `x-forwarded-proto`-aware pattern already used
// for SCIM base URLs elsewhere in this file, for the same reason: behind a reverse
// proxy the socket only knows http.
function webauthnRpId(req) { return String(req.headers.host ?? '').split(':')[0].toLowerCase(); }
function webauthnOrigin(req) { return `${req.headers['x-forwarded-proto'] ?? 'http'}://${req.headers.host}`; }

// Repository understanding is workspace-scoped: `subpath` may name a directory inside the
// product workspace, never an absolute host path or a `..` escape out of it. Returns null on
// any attempt to leave, rather than clamping — a clamp would silently redirect a caller who
// asked for one directory to a scan of another.
function resolveWorkspaceSubpath(root, subpath) {
  const base = resolve(root);
  if (!subpath) return base;
  const candidate = resolve(base, String(subpath));
  return candidate === base || candidate.startsWith(`${base}${sep}`) ? candidate : null;
}

function json(res, status, value, extraHeaders = {}) {
  // A response whose headers are already out cannot be given a status any more.
  // Writing one anyway throws ERR_HTTP_HEADERS_SENT from inside an error handler,
  // which is how a single bad request used to become a process-wide failure.
  if (res.headersSent) {
    if (!res.writableEnded) res.end();
    return;
  }
  const body = JSON.stringify(value, null, 2);
  res.writeHead(status, {
    ...securityHeaders({ secureTransport:secureCookies }),
    'content-type':'application/json; charset=utf-8',
    'content-length':Buffer.byteLength(body),
    ...extraHeaders,
  });
  res.end(body);
}

async function body(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 64 * 1024 * 1024) throw Object.assign(new Error('Request body too large'), { status:413 });
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw Object.assign(new Error('Invalid JSON request body.'), { status:400 }); }
}

/**
 * The body as BYTES — for audio, which is not text and must not be round-tripped through one.
 *
 * A separate limit from `body()`'s 64 MiB, and a much smaller one: this is a spoken phrase, not
 * a file upload. A microphone that is left running is the ordinary way this route gets abused,
 * and it is abused by an authenticated user, so the ceiling is the control, not the credential.
 */
async function bytesBody(req, { limitBytes = 16 * 1024 * 1024 } = {}) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limitBytes) throw Object.assign(new Error('Audio too large.'), { status:413 });
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

function serveStatic(pathname, res) {
  const requested = pathname === '/' ? '/index.html' : pathname;
  const target = normalize(resolve(webRoot, `.${requested}`));
  if (target !== webRoot && !target.startsWith(`${webRoot}${sep}`)) return false;
  try {
    if (!statSync(target).isFile()) return false;
    const types = { '.html':'text/html; charset=utf-8', '.css':'text/css; charset=utf-8', '.js':'text/javascript; charset=utf-8', '.svg':'image/svg+xml', '.png':'image/png' };
    const bytes = readFileSync(target);
    res.writeHead(200, {
      ...securityHeaders({ contentSecurityPolicy:true, secureTransport:secureCookies }),
      'content-type':types[extname(target)] ?? 'application/octet-stream',
      'content-length':bytes.length,
    });
    res.end(bytes);
    return true;
  } catch { return false; }
}

/**
 * D-0279. A service account could be created, could be issued a token, and that token
 * could be verified — `userDirectory.authenticateServiceToken()` is complete and tested —
 * but NO request path ever called it, because this function read the session cookie and
 * nothing else. The role existed on paper and no program could ever use it: the same
 * shape of defect as the update-channel key in D-0272, a finished verifier with no way in.
 *
 * Cookie first, deliberately: a browser that holds a live session must not be able to
 * downgrade itself onto a token it also happens to send.
 *
 * The bearer branch fabricates a session-shaped object rather than returning `session:null`.
 * Routes elsewhere read `authenticated.session.elevatedUntil` to demand recent strong
 * reauthentication; with `null` those routes would throw a TypeError and answer 500, and a
 * 500 is not a denial. With `elevatedUntil:0` they answer 403 — which is the correct answer
 * for an account that has no password and no TOTP and therefore can never re-prove itself.
 */
function resolveAuthenticated(req) {
  const cookies = parseCookies(req.headers.cookie);
  const bySession = auth.authenticate(cookies.noesar_session);
  if (bySession) return bySession;
  const match = /^Bearer\s+(\S+)$/.exec(String(req.headers.authorization ?? ''));
  if (!match) return null;
  const resolved = userDirectory.authenticateServiceToken(match[1]);
  if (!resolved) return null;
  return {
    session:{ id:`service:${resolved.tokenId}`, elevatedUntil:0, csrfDigest:null },
    user:resolved.user,
    rawUser:null,
    nonInteractive:true,
    serviceTokenId:resolved.tokenId,
  };
}

function requireSession(req, res, permission = null) {
  const authenticated = resolveAuthenticated(req);
  if (!authenticated) {
    json(res, 401, { error:'Authentication required.' });
    return null;
  }
  if (permission && !auth.hasPermission(authenticated.user, permission)) {
    ledger.append({ actor:authenticated.user.id, action:'authorization.denied', result:'denied', details:{ permission } });
    json(res, 403, { error:'Permission denied.', permission });
    return null;
  }
  return authenticated;
}

/**
 * The session, if there is a valid one — and no response written either way.
 *
 * Distinct from requireSession on purpose: a route that must answer 200 to an
 * anonymous prober cannot use a helper whose failure mode is to send 401. It also
 * records nothing in the ledger, because /healthz is polled continuously and a probe
 * arriving without a cookie is the normal case, not a denial worth an audit entry.
 */
function optionalSession(req) {
  const cookies = parseCookies(req.headers.cookie);
  return auth.authenticate(cookies.noesar_session) ?? null;
}

/**
 * SCIM's own auth model (RFC 7644 §2): a bearer token, never a cookie. No CSRF check
 * applies here for the same reason none is added — CSRF defends an ambient credential a
 * browser sends automatically, and a bearer token in an Authorization header is never
 * ambient. Writes the RFC 7644 error shape, not the cookie-session one, on failure.
 */
function requireScimAuth(req, res) {
  const header = req.headers.authorization ?? '';
  const match = /^Bearer\s+(\S+)$/.exec(header);
  const resolved = match ? authenticateScimToken(scimTokenStore, match[1]) : null;
  if (!resolved) {
    json(res, 401, scimError(401, 'a valid SCIM bearer token is required'), { 'content-type':'application/scim+json; charset=utf-8' });
    return null;
  }
  return resolved;
}

function requireCsrf(req, res, authenticated) {
  // D-0279. A CSRF token defends an AMBIENT credential — one a browser attaches by itself
  // to a request some other site caused. A bearer token is never ambient: it exists only
  // because the caller put it in the header on purpose, so there is nothing for a third
  // party to ride. This is the same reasoning already written down for SCIM above, applied
  // to the one other bearer-authenticated caller this product now has.
  if (authenticated.nonInteractive) return true;
  if (!auth.verifyCsrf(authenticated.session, req.headers['x-noesar-csrf'])) {
    ledger.append({ actor:authenticated.user.id, action:'csrf.denied', result:'denied' });
    json(res, 403, { error:'CSRF validation failed.' });
    return false;
  }
  return true;
}

function requireOwner(req, res, permission = 'user.read') {
  const authenticated = requireSession(req, res, permission);
  if (!authenticated) return null;
  if (authenticated.user.role !== 'owner') {
    ledger.append({ actor:authenticated.user.id, action:'authorization.denied', result:'denied', details:{ required:'owner' } });
    json(res, 403, { error:'Owner role is required.' });
    return null;
  }
  return authenticated;
}

function text(res, status, body, contentType = 'text/plain; charset=utf-8') {
  const bytes = Buffer.from(body, 'utf8');
  res.writeHead(status, {
    ...securityHeaders({ secureTransport:secureCookies }),
    'content-type':contentType,
    'content-length':bytes.length,
  });
  res.end(bytes);
}

/**
 * Whether the connection this request arrived on can complete a browser sign-in.
 *
 * `req.socket.encrypted` is set by Node's TLS socket and by nothing else, so it reports the
 * transport that actually carried THIS request — the two listeners share one handler, and a
 * process-level flag could not tell them apart.
 */
function browserSignInAdvice(req) {
  return browserSignIn({
    encrypted: Boolean(req.socket?.encrypted),
    secureCookies,
    tlsListenerExists: Boolean(tlsPort && tls.active),
    publicTlsUrl: process.env.NOESAR_PUBLIC_TLS_URL,
  });
}

function sessionResponse(req, res, value, status = 200) {
  const advice = browserSignInAdvice(req);
  json(res, status, {
    user:value.user,
    csrfToken:value.csrf,
    // Carried on the response that ISSUES the cookie, not only on /auth/status: a client that
    // reaches this point has already been told "signed in" by the status code, and for a
    // browser on the plain listener that is the exact moment the claim stops being true.
    ...(advice.browserSignInPossible ? {} : { transport:advice }),
    // Sent here as well as on /auth/me: the interface enters the application straight
    // from this response and must know which sections to offer before its first fetch.
    permissions:auth.permissionsFor(value.user.role),
    session:{ expiresAt:new Date(value.session.expiresAt).toISOString(), idleExpiresAt:new Date(value.session.idleExpiresAt).toISOString() },
  }, { 'set-cookie':auth.cookieHeaders(value) });
}

const requestListener = async (req, res) => {
  // One correlation id per inbound request, propagated to the client through a
  // response header so a user-visible failure can be found in the logs.
  const requestId = randomUUID();
  const startedAt = process.hrtime.bigint();
  res.setHeader('x-request-id', requestId);
  res.setHeader('x-correlation-id', requestId);
  const url0 = (() => { try { return new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`); } catch { return null; } })();
  res.once('finish', () => {
    const seconds = Number(process.hrtime.bigint() - startedAt) / 1e9;
    const route = url0?.pathname ?? '/';
    metrics.observeHttp({ route, status:res.statusCode, seconds });
    logger.log(res.statusCode >= 500 ? 'ERROR' : res.statusCode >= 400 ? 'WARN' : 'INFO', 'http.request', {
      correlation_id:requestId, component:'control-plane',
      http:{ method:req.method, path:route, status:res.statusCode, ms:Math.round(seconds * 1000) },
    });
  });
  if (!validHostHeader(req.headers.host, allowedHosts)) {
    ledger.append({ actor:'anonymous', action:'host-header.denied', result:'denied', details:{ host:req.headers.host } });
    return json(res, 421, { error:'Unrecognized Host header.', requestId });
  }
  const url = new URL(req.url ?? '/', `http://${req.headers.host}`);
  try {
    // --- a browser opening a page on the plain listener ------------------------
    // Structural, ahead of the route table, for the reason the safe-mode gate below is:
    // a page added later cannot forget it. Only page loads move, only when the encrypted
    // address is declared, and never the certificate routes — see shouldRedirectToSecure.
    const secureDestination = shouldRedirectToSecure({
      encrypted:Boolean(req.socket?.encrypted), method:req.method,
      accept:req.headers.accept, pathname:url.pathname,
      publicTlsUrl:process.env.NOESAR_PUBLIC_TLS_URL, secureCookies,
    });
    if (secureDestination) {
      // 302, not 301: a permanent redirect is cached by the browser and would survive the
      // operator turning TLS back off, leaving a bookmark pointing at a port that no longer
      // answers — the failure this exists to remove, in the other direction.
      res.writeHead(302, { location:`${secureDestination}${req.url}`, 'cache-control':'no-store' });
      return res.end();
    }
    // --- liveness, readiness, health, metrics --------------------------------
    // /livez performs no dependency check on purpose: a slow data plane must
    // never cause a live process to be killed and restarted.
    if (req.method === 'GET' && url.pathname === '/livez') {
      return json(res, 200, { status:'alive', pid:process.pid, uptimeSeconds:Math.round(process.uptime()), checkedAt:toUtcIso() });
    }
    if (req.method === 'GET' && url.pathname === '/readyz') {
      const readiness = buildReadiness({ watchdog, auth, dataPlane });
      return json(res, readiness.ready ? 200 : 503, readiness);
    }
    // --- how another machine obtains the launcher ------------------------------
    // Unauthenticated on purpose, and narrowly: a fixed table of four AGPL source files
    // plus their digests. Requiring a session to download the thing you sign in WITH is a
    // loop, and the caller this route exists for has no credentials yet. Nothing derived
    // from this installation is served, and no fragment of the request ever reaches a
    // path — see src/cli-downloads.mjs for why that is unrepresentable rather than
    // defended against.
    if (req.method === 'GET' && (url.pathname === '/cli' || url.pathname === '/cli/')) {
      return text(res, 200, renderCliIndex(`${url.protocol}//${req.headers.host}`));
    }
    if (req.method === 'GET') {
      const wanted = resolveCliDownload(url.pathname);
      if (wanted) {
        const artifact = readCliArtifact(repoRoot, wanted);
        if (!artifact) {
          // A real state, not an error: an image built before these files were shipped
          // does not contain them, and saying so beats a stack trace or a blank 200.
          return text(res, 404, `${wanted.basename} is not shipped by this installation\n`);
        }
        if (wanted.digestOnly) {
          return text(res, 200, `${artifact.sha256}  ${wanted.basename}\n`);
        }
        return text(res, 200, artifact.bytes.toString('utf8'), wanted.contentType);
      }
    }
    // --- how a device comes to trust this installation -------------------------
    // Unauthenticated for the reason /cli states one floor up, sharpened: the session is
    // carried by a cookie the browser only sends over a connection it trusts, and this is
    // the file that makes it trust the connection. A CA certificate is a public key and a
    // name; `ca.key` is never read by this process and cannot be named by a request.
    if (req.method === 'GET' && (url.pathname === '/ca' || url.pathname === '/ca/')) {
      return text(res, trustAnchor.available ? 200 : 404, renderTrustAnchorIndex(trustAnchor, `${url.protocol}//${req.headers.host}`));
    }
    if (req.method === 'GET' && url.pathname === `/${TRUST_ANCHOR_BASENAME}`) {
      // 404 rather than 500: "this installation has no anchor to hand out" is a real,
      // supported state (plaintext, or a publicly-issued certificate), not a fault.
      if (!trustAnchor.available) return text(res, 404, `${trustAnchor.reason}\n`);
      res.setHeader('Content-Disposition', `attachment; filename="${TRUST_ANCHOR_BASENAME}"`);
      return text(res, 200, trustAnchor.pem, TRUST_ANCHOR_CONTENT_TYPE);
    }
    if (req.method === 'GET' && url.pathname === `/${TRUST_ANCHOR_BASENAME}.sha256`) {
      if (!trustAnchor.available) return text(res, 404, `${trustAnchor.reason}\n`);
      return text(res, 200, `${trustAnchor.fileSha256}  ${TRUST_ANCHOR_BASENAME}\n`);
    }
    if (req.method === 'GET' && url.pathname === '/healthz') {
      // Never 401, never 403: the container healthcheck, three platform installers and
      // the update manager's post-start poll all read this route without a session, and
      // an authentication error there reads as a dead service. The status code is
      // therefore computed from the full health for everyone — what varies is only how
      // much of the body the caller is entitled to see.
      const health = buildHealth({
        product:PRODUCT, watchdog, auth, authority, dataPlane, logger, updateManager,
        timezone:timezoneService.serverDefault(), debug:debugMode.status(),
      });
      const disclose = allowsUnauthenticatedHealthDetail(exposureScope, clientIp(req))
        || mayReadHealthDetail(optionalSession(req)?.user);
      return json(res, health.status === 'unhealthy' ? 503 : 200, disclose ? health : publicHealth(health));
    }
    if (req.method === 'GET' && url.pathname === '/metrics') {
      // Authenticated, unless this container is published on loopback AND the peer is
      // a private address. The unauthenticated path is deliberately narrow: behind a
      // published port every caller arrives from the bridge gateway, which is itself
      // an RFC1918 address, so a private peer only implies "a process on this host"
      // while the publish is loopback-only. On a LAN publish it implies nothing, and
      // the exporter (request paths, status codes, safe-mode state, log volume) would
      // otherwise be readable by the whole subnet. See docs/LAN_ACCESS_CONFIGURATION.md.
      if (!allowsUnauthenticatedMetrics(exposureScope, clientIp(req))) {
        const authenticated = requireSession(req, res, 'audit.read');
        if (!authenticated) return;
      }
      metrics.setGauge('noesar_safe_mode', watchdog.safeMode.active ? 1 : 0);
      metrics.setGauge('noesar_log_bytes', logger.stats().bytes);
      metrics.setGauge('noesar_data_plane_up', 1);
      return text(res, 200, metrics.render(), 'text/plain; version=0.0.4; charset=utf-8');
    }
    if (req.method === 'GET' && url.pathname === '/diagnostics') {
      const authenticated = requireOwner(req, res, 'audit.read');
      if (!authenticated) return;
      const health = buildHealth({
        product:PRODUCT, watchdog, auth, authority, dataPlane, logger, updateManager,
        timezone:timezoneService.serverDefault(), debug:debugMode.status(),
      });
      return json(res, 200, debugMode.bundle({
        product:PRODUCT,
        host:{ platform:process.platform, arch:process.arch, node:process.version, cpuCores:hardware?.cpu?.cores ?? null },
        timezone:timezoneService.effectiveFor(authenticated.user.id),
        health, watchdog:watchdog.report(), updates:updateManager.status(),
        logs:logger.search({ limit:Number(url.searchParams.get('logLimit') ?? 100) }),
      }));
    }

    // --- safe mode gate -----------------------------------------------------
    // Structural, ahead of the route table, so a new mutating route cannot forget it.
    if (watchdog.safeMode.active
      && !['GET', 'HEAD', 'OPTIONS'].includes(req.method)
      && !SAFE_MODE_WRITE_ALLOWLIST.has(url.pathname)) {
      logger.warn('safe-mode.request.blocked', { correlation_id:requestId, http:{ method:req.method, path:url.pathname } });
      return json(res, 503, {
        error:'NOESAR is in safe mode; providers, agents, tools and state changes are disabled.',
        reason:watchdog.safeMode.reason, since:watchdog.safeMode.since,
        readableInSafeMode:['documents', 'audit history', 'health', 'diagnostics'],
        requestId,
      });
    }

    if (req.method === 'GET' && url.pathname === '/api/v1/auth/status') {
      return json(res, 200, { ...auth.status(), ...browserSignInAdvice(req) });
    }
    if (req.method === 'POST' && url.pathname === '/api/v1/auth/setup') {
      const request = await body(req);
      return json(res, 201, auth.beginSetup({ ...request, suppliedSetupToken:req.headers['x-noesar-setup-token'] }));
    }
    if (req.method === 'POST' && url.pathname === '/api/v1/auth/setup/confirm') {
      const value = auth.confirmSetup(await body(req));
      return sessionResponse(req, res, value, 201);
    }
    if (req.method === 'POST' && url.pathname === '/api/v1/auth/login') return json(res, 202, auth.beginLogin({ ...(await body(req)), ip:clientIp(req) }));
    if (req.method === 'POST' && url.pathname === '/api/v1/auth/login/mfa') {
      const value = auth.completeLogin({ ...(await body(req)), ip:clientIp(req) });
      return sessionResponse(req, res, value);
    }
    if (req.method === 'POST' && url.pathname === '/api/v1/auth/login/passkey/options') {
      const payload = await body(req);
      return json(res, 200, auth.passkeyLoginOptions({ challenge:payload.challenge, rpId:webauthnRpId(req) }));
    }
    if (req.method === 'POST' && url.pathname === '/api/v1/auth/login/passkey') {
      const payload = await body(req);
      const value = auth.completeLoginWithPasskey({
        challenge:payload.challenge, credentialId:payload.credentialId,
        clientDataJSON:payload.clientDataJSON, authenticatorData:payload.authenticatorData, signature:payload.signature,
        ip:clientIp(req), rpId:webauthnRpId(req), origin:webauthnOrigin(req),
      });
      return sessionResponse(req, res, value);
    }
    if (req.method === 'GET' && url.pathname === '/api/v1/auth/me') {
      const authenticated = requireSession(req, res);
      if (!authenticated) return;
      return json(res, 200, {
        user:authenticated.user,
        elevatedUntil:authenticated.session.elevatedUntil,
        permissions:auth.permissionsFor(authenticated.user.role),
      });
    }
    if (req.method === 'POST' && url.pathname === '/api/v1/auth/reauth') {
      const authenticated = requireSession(req, res, 'coden.owner-bypass');
      if (!authenticated || !requireCsrf(req, res, authenticated)) return;
      return json(res, 200, auth.reauthenticate({ sessionId:authenticated.session.id, ...(await body(req)) }));
    }
    // One authentication, not two (D-0337). The browser is already inside; this hands it a
    // short single-use code to type at a terminal, instead of making the same operator prove
    // themselves a second time to the unix socket.
    //
    // Minting is here; SPENDING is not, and its absence is the design. There is no
    // `/api/v1/auth/attach` — a code is redeemable only over the unix socket
    // (`session-protocol.mjs`, `auth.attach`), where the filesystem has already decided who
    // may knock. Exposing redemption over HTTP would have handed the network an
    // unauthenticated endpoint to grind against, which is the one thing a bearer ticket
    // with no IP binding cannot afford.
    if (req.method === 'POST' && url.pathname === '/api/v1/auth/attach-code') {
      const authenticated = requireSession(req, res);
      if (!authenticated || !requireCsrf(req, res, authenticated)) return;
      return json(res, 201, auth.mintAttachCode({
        userId:authenticated.user.id, sessionId:authenticated.session.id,
      }));
    }
    // --- account security ----------------------------------------------------
    // Every route here acts on the CALLER's own account. There is deliberately no
    // "change another user's password" or "replace another user's authenticator": an
    // administrator can disable, revoke or erase an account from the directory, but
    // must not be able to silently take one over and keep operating as that person.
    if (req.method === 'GET' && url.pathname === '/api/v1/auth/security') {
      const authenticated = requireSession(req, res);
      if (!authenticated) return;
      return json(res, 200, auth.securityOverview(authenticated.user.id, authenticated.session.id));
    }
    if (req.method === 'POST' && url.pathname === '/api/v1/auth/password') {
      const authenticated = requireSession(req, res);
      if (!authenticated || !requireCsrf(req, res, authenticated)) return;
      const payload = await body(req);
      return json(res, 200, auth.changePassword({
        userId:authenticated.user.id, sessionId:authenticated.session.id,
        currentPassword:payload.currentPassword, totpCode:payload.totpCode,
        newPassword:payload.newPassword, revokeOtherSessions:payload.revokeOtherSessions !== false,
      }));
    }
    if (req.method === 'POST' && url.pathname === '/api/v1/auth/mfa/replace') {
      const authenticated = requireSession(req, res);
      if (!authenticated || !requireCsrf(req, res, authenticated)) return;
      const payload = await body(req);
      return json(res, 200, auth.beginMfaReplacement({
        userId:authenticated.user.id, password:payload.password, totpCode:payload.totpCode,
      }));
    }
    if (req.method === 'POST' && url.pathname === '/api/v1/auth/mfa/replace/confirm') {
      const authenticated = requireSession(req, res);
      if (!authenticated || !requireCsrf(req, res, authenticated)) return;
      const payload = await body(req);
      return json(res, 200, auth.confirmMfaReplacement({
        userId:authenticated.user.id, sessionId:authenticated.session.id,
        challenge:payload.challenge, firstCode:payload.firstCode, secondCode:payload.secondCode,
        revokeOtherSessions:payload.revokeOtherSessions !== false,
      }));
    }
    if (req.method === 'POST' && url.pathname === '/api/v1/auth/mfa/replace/cancel') {
      const authenticated = requireSession(req, res);
      if (!authenticated || !requireCsrf(req, res, authenticated)) return;
      return json(res, 200, auth.cancelMfaReplacement(authenticated.user.id));
    }
    if (req.method === 'GET' && url.pathname === '/api/v1/auth/passkeys') {
      const authenticated = requireSession(req, res);
      if (!authenticated) return;
      return json(res, 200, { passkeys:auth.listPasskeys(authenticated.user.id) });
    }
    if (req.method === 'POST' && url.pathname === '/api/v1/auth/passkeys/register') {
      const authenticated = requireSession(req, res);
      if (!authenticated || !requireCsrf(req, res, authenticated)) return;
      const payload = await body(req);
      return json(res, 200, auth.beginPasskeyRegistration({
        userId:authenticated.user.id, password:payload.password, totpCode:payload.totpCode, rpId:webauthnRpId(req),
      }));
    }
    if (req.method === 'POST' && url.pathname === '/api/v1/auth/passkeys/register/confirm') {
      const authenticated = requireSession(req, res);
      if (!authenticated || !requireCsrf(req, res, authenticated)) return;
      const payload = await body(req);
      return json(res, 201, auth.confirmPasskeyRegistration({
        userId:authenticated.user.id, challenge:payload.challenge, credentialId:payload.credentialId,
        clientDataJSON:payload.clientDataJSON, attestationObject:payload.attestationObject, name:payload.name,
        rpId:webauthnRpId(req), origin:webauthnOrigin(req),
      }));
    }
    if (req.method === 'POST' && url.pathname === '/api/v1/auth/passkeys/remove') {
      const authenticated = requireSession(req, res);
      if (!authenticated || !requireCsrf(req, res, authenticated)) return;
      const payload = await body(req);
      return json(res, 200, auth.removePasskey({
        userId:authenticated.user.id, password:payload.password, totpCode:payload.totpCode, credentialId:payload.credentialId,
      }));
    }
    if (req.method === 'POST' && url.pathname === '/api/v1/auth/recovery-codes') {
      const authenticated = requireSession(req, res);
      if (!authenticated || !requireCsrf(req, res, authenticated)) return;
      const payload = await body(req);
      return json(res, 201, auth.regenerateRecoveryCodes({
        userId:authenticated.user.id, password:payload.password, totpCode:payload.totpCode,
      }));
    }
    if (req.method === 'POST' && url.pathname === '/api/v1/auth/sessions/revoke-others') {
      const authenticated = requireSession(req, res);
      if (!authenticated || !requireCsrf(req, res, authenticated)) return;
      return json(res, 200, auth.revokeOtherSessions({
        userId:authenticated.user.id, sessionId:authenticated.session.id,
      }));
    }
    if (req.method === 'POST' && url.pathname === '/api/v1/auth/sessions/revoke') {
      const authenticated = requireSession(req, res);
      if (!authenticated || !requireCsrf(req, res, authenticated)) return;
      const payload = await body(req);
      return json(res, 200, auth.revokeSession({
        userId:authenticated.user.id, sessionId:authenticated.session.id,
        targetSessionId:payload.sessionId,
      }));
    }
    if (req.method === 'POST' && url.pathname === '/api/v1/auth/logout') {
      const authenticated = requireSession(req, res);
      if (!authenticated || !requireCsrf(req, res, authenticated)) return;
      auth.logout(authenticated.session.id, authenticated.user.id);
      return json(res, 200, { loggedOut:true }, { 'set-cookie':auth.clearCookieHeaders() });
    }

    if (req.method === 'GET' && url.pathname === '/api/v1/privacy') {
      const authenticated = requireSession(req, res, 'user.read'); if (!authenticated) return;
      const privacy = currentPrivacy(authenticated.user);
      return json(res, 200, { ...privacy, banner:privacyBanner(privacy.state) });
    }
    if (req.method === 'POST' && url.pathname === '/api/v1/privacy/egress-plan') {
      const authenticated = requireSession(req, res, 'user.read');
      if (!authenticated || !requireCsrf(req, res, authenticated)) return;
      const request = await body(req);
      const plan = evaluateEgress(request);
      // The plan is an answer to a question, not a change to this installation. It is
      // deliberately NOT written to the indicator: see the note beside `currentPrivacy`.
      ledger.append({ actor:authenticated.user.id, action:'egress.plan', result:plan.allowed ? 'allowed':'approval-required', details:plan });
      return json(res, 200, plan);
    }
    // The revoke control every external disclosure advertises. A control named in a
    // disclosure and wired to nothing would be exactly the class of false claim this
    // indicator exists to prevent, so it withdraws consent everywhere at once and the
    // test suite asserts the state actually returns to local-only afterwards.
    if (req.method === 'POST' && url.pathname === '/api/v1/privacy/revoke') {
      const authenticated = requireSession(req, res, 'provider.manage');
      if (!authenticated || !requireCsrf(req, res, authenticated)) return;
      const before = currentPrivacy();
      const revoked = { providers:[], tools:[] };
      for (const profile of aiStore.read().providerProfiles ?? []) {
        if (!profile.external) continue;
        providerGateway.grantConsent(profile.id, { granted:false });
        providerGateway.update(profile.id, { enabled:false });
        revoked.providers.push(profile.id);
      }
      for (const tool of aiStore.read().tools ?? []) {
        if (!tool.external) continue;
        agentService.grantToolConsent(tool.id, { granted:false }, authenticated.user.id);
        revoked.tools.push(tool.id);
      }
      lastPolicyViolation = null;
      const after = currentPrivacy();
      ledger.append({ actor:authenticated.user.id, action:'privacy.revoke', result:'success', details:{ ...revoked, from:before.state, to:after.state } });
      return json(res, 200, { revoked, state:after.state, disclosures:after.disclosures, banner:privacyBanner(after.state) });
    }
    // ── The model catalogue · s333 point 5 ─────────────────────────────────────────────
    // Owner, s318 and again s333: «su #/models deve esserci un menu con i modelli e i modelli
    // scaricati e installati devono sempre visualizzarsi per primi». Designed in s320, and the
    // design said in its own first line that nothing in it was implemented — which stayed true
    // for thirteen sessions. The lanes, the grouping and the refusals live in
    // `model-catalog.mjs`; this route supplies the three facts only the server knows: what is
    // on disk, what is running, and whether the runtime is allowed to start anything.
    // Owner, s335: «1 modello che viene caricato lo vedano tutti, anche i moduli».
    //
    // One route, one answer, and deliberately the SAME snapshot the catalogue renders from —
    // two routes computing "the active model" separately is how a module and the operator's own
    // page come to disagree about the installation they are both looking at. A module reaches
    // this through the module proxy with its service token, which is why the permission is
    // `model.read` and not an owner-only one: reading which model is loaded is not authority
    // over it, and a module that cannot see the model cannot use it.
    if (req.method === 'GET' && url.pathname === '/api/v1/models/active') {
      const authenticated = requireSession(req, res, 'model.read'); if (!authenticated) return;
      await refreshActiveModel({ force: url.searchParams.get('refresh') === '1' });
      return json(res, 200, activeModelReport(activeModelSnapshot, { usedBy: activeModelConsumers() }));
    }
    if (req.method === 'GET' && url.pathname === '/api/v1/models/catalog') {
      const authenticated = requireSession(req, res, 'model.read'); if (!authenticated) return;
      const runtimeConfig = localModels.config();
      // Awaited, but bounded: `refreshActiveModel` returns the held snapshot inside the TTL and
      // the probe underneath carries its own timeout, so this cannot become the page that hangs.
      await refreshActiveModel();
      const descriptors = readModelDescriptors();
      // Presence is read HERE and not in the catalogue module, which is what keeps MC-005
      // true by construction: a module that never imports `node:fs` cannot make a request.
      const present = readPresentModels(descriptors);
      const filter = {
        type: url.searchParams.get('type'), fn: url.searchParams.get('fn'),
        text: url.searchParams.get('q'), publisherId: url.searchParams.get('publisher'),
      };
      const page = Number.parseInt(url.searchParams.get('page') ?? '1', 10);
      try {
        return json(res, 200, buildCatalog({
          descriptors, present, activeModelId: activeModelId(),
          filter: Object.values(filter).some(Boolean) ? filter : null,
          page: Number.isInteger(page) && page > 0 ? page : 1,
          runtime: runtimeConfig,
        }));
      } catch (error) {
        return json(res, 400, { error: error.reason ?? error.message, kind: error.kind ?? 'INVALID_REQUEST' });
      }
    }
    // ---- Voice. Owner, s336: «fai un motore reale interno con voce naturale». ----------------
    //
    // `model.read` for the state and `provider.use` for the two verbs — the same permissions the
    // rest of the product uses for "which model is there" and "run a turn on it". Every role
    // holds `provider.use`, so voice is available to anyone who can hold a conversation at all,
    // which is the only posture that makes sense for a microphone.
    if (req.method === 'GET' && url.pathname === '/api/v1/voice/state') {
      const authenticated = requireSession(req, res, 'model.read'); if (!authenticated) return;
      return json(res, 200, await voiceReadiness({
        routing: voiceRoutingFrom(process.env),
        fetchImpl: typeof fetch === 'function' ? fetch : undefined,
      }));
    }
    // Raw audio in, text out. The bytes arrive as the body with `content-type` naming the format
    // the browser recorded — the multipart assembly the model server expects happens in
    // `voice-engine.mjs`, once, rather than being a shape the client has to get right.
    if (req.method === 'POST' && url.pathname === '/api/v1/voice/transcribe') {
      const authenticated = requireSession(req, res, 'provider.use');
      if (!authenticated || !requireCsrf(req, res, authenticated)) return;
      const audio = await bytesBody(req);
      try {
        const heard = await transcribe({
          audio: new Uint8Array(audio),
          mimeType: String(req.headers['content-type'] ?? 'audio/webm').split(';')[0].trim(),
          routing: voiceRoutingFrom(process.env),
          fetchImpl: typeof fetch === 'function' ? fetch : undefined,
        });
        return json(res, 200, heard);
      } catch (error) {
        if (!(error instanceof VoiceEngineError)) throw error;
        return json(res, error.status, { error: error.reason, kind: error.kind });
      }
    }
    // Text in, AUDIO out — the bytes themselves, in the response. Not a URL: audio generated from
    // a conversation this product holds must not become a second address that outlives the
    // request and can be fetched by anyone who guesses it.
    if (req.method === 'POST' && url.pathname === '/api/v1/voice/speak') {
      const authenticated = requireSession(req, res, 'provider.use');
      if (!authenticated || !requireCsrf(req, res, authenticated)) return;
      const request = await body(req);
      try {
        const said = await speak({
          text: request?.text,
          voice: request?.voice ?? null,
          routing: voiceRoutingFrom(process.env),
          fetchImpl: typeof fetch === 'function' ? fetch : undefined,
        });
        res.writeHead(200, {
          ...securityHeaders({ secureTransport:secureCookies }),
          'content-type': said.contentType,
          'content-length': said.audio.length,
          // Spoken answers are about a live conversation. A cached one is yesterday's answer
          // read aloud in today's voice.
          'cache-control': 'no-store',
        });
        return res.end(Buffer.from(said.audio));
      } catch (error) {
        if (!(error instanceof VoiceEngineError)) throw error;
        return json(res, error.status, { error: error.reason, kind: error.kind });
      }
    }
    // Asked ONLY when the deterministic resolver could not place what was heard. The model is
    // given the product's own entries and told to name one of them or NONE; the reply is
    // accepted only if it names one, so a model that invents can only ever pick the wrong door
    // of this product's own doors, never a door that does not exist.
    //
    // THE CLIENT DOES NOT PROPOSE THE LIST. It sends the sentence and nothing else; the
    // candidates are built here, from this session's own identity — the commands this account
    // may use plus the addresses this installation serves. A first draft took the list from the
    // request body and intersected it, which is weaker for no benefit: a client that can name
    // the candidates is a client that decides what the model is allowed to pick, and the whole
    // guarantee of this route is that voice cannot reach past what this account could type.
    if (req.method === 'POST' && url.pathname === '/api/v1/voice/interpret') {
      const authenticated = requireSession(req, res, 'provider.use');
      if (!authenticated || !requireCsrf(req, res, authenticated)) return;
      const request = await body(req);
      // `permissionsFor` takes a ROLE, not a user — the same matrix `/api/v1/auth/me` hands the
      // browser, so the list the model chooses from is exactly the menu that account sees.
      const account = accountFromUser({
        permissions: auth.permissionsFor(authenticated.user?.role),
        role: authenticated.user?.role ?? null,
      });
      const candidates = [
        ...menuFor(account).entries.map((entry) => ({ name: entry.name, summary: entry.summary ?? '' })),
        ...buildCodenAddressBook(webRoot).map((entry) => ({ name: entry.address, summary: entry.label ?? entry.address })),
      ];
      const decision = await chooseDestination({
        utterance: request?.text,
        entries: candidates,
        endpoint: process.env.NOESAR_AUTHORING_ENDPOINT ?? null,
        model: process.env.NOESAR_AUTHORING_MODEL ?? null,
        fetchImpl: typeof fetch === 'function' ? fetch : undefined,
      });
      // 200 in every case: "the model found nothing that fits" is an ANSWER, and a 4xx would make
      // the surface treat an honest refusal as a fault it should complain about.
      return json(res, 200, decision.kind === VoiceChoice.CHOSEN
        ? { chosen: decision.name }
        : { chosen: null, kind: decision.kind, reason: decision.reason });
    }
    // The only mutating verb of this panel, and the only one that spends authority. It PLANS
    // and refuses; it does not download here. Acquisition is egress plus a write to disk plus
    // an execution, and each of those already has a gate in this product — what was missing
    // was the decision that says which gates a model acquisition must pass, in what order.
    if (req.method === 'POST' && url.pathname === '/api/v1/models/acquire') {
      const authenticated = requireSession(req, res, 'model.manage');
      if (!authenticated || !requireCsrf(req, res, authenticated)) return;
      const request = await body(req);
      const descriptor = readModelDescriptors().find((entry) => entry.id === request?.id) ?? null;
      if (!descriptor) return json(res, 404, { error: 'no descriptor with that id is known to this installation' });
      const privacy = currentPrivacy(authenticated.user);
      const plan = planAcquisition({
        descriptor,
        registry: publisherRegistry,
        runtime: localModels.config(),
        // Egress consent is the product's own state, not a parameter of the request: a caller
        // must not be able to assert its own consent.
        egressAllowed: privacy.state === 'external',
        maxBytes: MODEL_ACQUIRE_MAX_BYTES,
      });
      ledger.append({
        actor: authenticated.user.id, action: 'model.acquire',
        result: plan.allowed ? 'planned' : 'refused',
        details: { id: descriptor.id, publisher: descriptor.publisher, kind: plan.kind ?? null },
      });
      if (!plan.allowed) return json(res, 403, { error: plan.reason, kind: plan.kind });
      // Declared rather than pretended: the transport that fetches the bytes is not built on
      // this installation. Answering 202 with an invented job id would be the false
      // declaration this product exists to remove.
      return json(res, 501, {
        error: 'this installation has no model transport configured, so the artefact cannot be fetched yet',
        kind: 'NO_TRANSPORT', grant: plan.grant,
      });
    }
    if (req.method === 'GET' && url.pathname === '/api/v1/hardware') {
      const authenticated = requireSession(req, res, 'hardware.read'); if (!authenticated) return;
      return json(res, 200, hardware);
    }
    if (req.method === 'POST' && url.pathname === '/api/v1/runtime/recommendation') {
      const authenticated = requireSession(req, res, 'runtime.plan');
      if (!authenticated || !requireCsrf(req, res, authenticated)) return;
      return json(res, 200, recommendRuntime(hardware, await body(req)));
    }
    if (req.method === 'POST' && url.pathname === '/api/v1/coden/path-plan') {
      const authenticated = requireSession(req, res, 'coden.plan');
      if (!authenticated || !requireCsrf(req, res, authenticated)) return;
      const request = await body(req);
      if (request.mode === 'OWNER_BYPASS' && !auth.hasPermission(authenticated.user, 'coden.owner-bypass')) return json(res, 403, { error:'Owner role is required for Owner Bypass.' });
      const plan = createPathPlan(request, workspace);
      ledger.append({ actor:authenticated.user.id, action:'coden.path-plan', result:plan.blocked ? 'blocked':'planned', details:{ canonicalPath:plan.canonicalPath, risk:plan.risk, mode:plan.mode } });
      return json(res, plan.blocked ? 403 : 200, plan);
    }
    // Live authority — UI-035 names "live authority tokens" as a field of the workbench's
    // own status line. The authorisations were written and never read back, so the field
    // had no source and the operator had no way to see what was still granted. Expiry is
    // computed here rather than stored as a flag: a flag would have to be swept, and an
    // unswept flag is a grant that looks live after it has lapsed.
    if (req.method === 'GET' && url.pathname === '/api/v1/coden/authorisations') {
      const authenticated = requireSession(req, res, 'coden.plan'); if (!authenticated) return;
      const at = Date.now();
      const live = store.read().approvals
        .filter((item) => Date.parse(item.expiresAt ?? 0) > at)
        .map((item) => ({
          id:item.id, canonicalPath:item.canonicalPath, operation:item.operation,
          mode:item.mode, consentScope:item.consentScope, createdAt:item.createdAt,
          expiresAt:item.expiresAt, secondsRemaining:Math.round((Date.parse(item.expiresAt) - at) / 1000),
        }))
        .sort((left, right) => (left.expiresAt < right.expiresAt ? -1 : 1));
      return json(res, 200, { live, count:live.length });
    }
    // Git branch status for the top bar (`main ↑2` in the s313/s317 addendum mockup) — read
    // only, never a write/fetch. Same optional-subpath boundary as repo-map: a path outside
    // the workspace is rejected before git ever sees it, not after. Not ledgered: this is
    // polled the same way authorisations is, not a deliberate scan worth auditing.
    // Phase 7 (`CE-010`): the divergence profile for a named set of paths — the browser's twin
    // of the terminal's `coden.divergence`. Both call the SAME profiler against the SAME root,
    // so the profile shown beside a diff and the one printed in a terminal are one reading of
    // one repository, not two that could disagree.
    //
    // POST, not GET: the paths are the request, a list of them does not belong in a query
    // string, and profiling walks git history — which is work, and a verb that says so.
    if (req.method === 'POST' && url.pathname === '/api/v1/coden/divergence') {
      // `requireCsrf` like every other POST here. This one mutates nothing, but it walks git
      // history over paths the caller names — a route a foreign page can make the browser call
      // is a route that spends this server's time on that page's behalf.
      const authenticated = requireSession(req, res, 'coden.plan');
      if (!authenticated || !requireCsrf(req, res, authenticated)) return;
      const request = await body(req);
      const paths = Array.isArray(request?.paths) ? request.paths.map(String).filter(Boolean) : [];
      if (!paths.length) return json(res, 400, { error: 'a divergence profile needs the paths a change touches' });
      try {
        const profiled = await profileChange(workspace, paths);
        return json(res, 200, { available: true, reason: null, signals: profiled.signals, basis: profiled.basis });
      } catch (error) {
        // A workspace with no git history is a real installation. It is told so, with the
        // reason, rather than being handed a 500 for a condition nothing went wrong in.
        if (error?.name !== 'DivergenceUnavailable') throw error;
        return json(res, 200, { available: false, reason: error.reason ?? error.message, signals: [], basis: null });
      }
    }

    if (req.method === 'GET' && url.pathname === '/api/v1/coden/git-status') {
      const authenticated = requireSession(req, res, 'coden.plan'); if (!authenticated) return;
      const target = resolveWorkspaceSubpath(workspace, url.searchParams.get('path'));
      if (!target) return json(res, 400, { error:'invalid_path', reason:'path escapes the workspace' });
      return json(res, 200, await gitStatus(target));
    }
    if (req.method === 'POST' && url.pathname === '/api/v1/coden/authorize') {
      const authenticated = requireSession(req, res, 'coden.authorize');
      if (!authenticated || !requireCsrf(req, res, authenticated)) return;
      const request = await body(req);
      if (!request.plan || !request.consentScope) return json(res, 400, { error:'plan and consentScope are required' });
      // SEC-003. The submitted plan is a claim the caller makes about itself, not
      // evidence: `blocked`, `canonicalPath` and `nonBypassableInvariants` are all
      // caller-writable, and nothing obliges the caller to have called path-plan at
      // all. Recompute the verdict from the operands the plan names, and use only the
      // recomputation from here on — the same rule the verifier work states for any
      // checked answer: recalculate from the original operands, never read the verdict
      // back off the answer's own path.
      let plan;
      try {
        plan = createPathPlan({
          path:request.plan.requestedPath,
          operation:request.plan.operation,
          mode:request.plan.mode,
          recursive:request.plan.recursive,
          commands:request.plan.commands,
          dependencies:request.plan.dependencies,
          networkRequested:request.plan.networkRequested,
          secretsRequested:request.plan.secretsRequested,
        }, workspace);
      } catch {
        return json(res, 400, { error:'The submitted plan does not name a path that can be re-planned.' });
      }
      // A disagreement between what the caller submitted and what the server computes
      // is either tampering or a stale plan. The recomputation wins either way, but it
      // is recorded rather than silently normalised.
      if (request.plan.blocked !== plan.blocked
        || request.plan.canonicalPath !== plan.canonicalPath
        || String(request.plan.mode ?? 'NORMAL') !== plan.mode) {
        ledger.append({ actor:authenticated.user.id, action:'coden.plan-mismatch', result:'recomputed', details:{ submittedPath:String(request.plan.canonicalPath ?? ''), canonicalPath:plan.canonicalPath, submittedBlocked:Boolean(request.plan.blocked), blocked:plan.blocked } });
      }
      if (plan.blocked) {
        ledger.append({ actor:authenticated.user.id, action:'coden.authorize', result:'blocked', details:{ canonicalPath:plan.canonicalPath, risk:plan.risk, mode:plan.mode } });
        return json(res, 403, { error:'Blocked path cannot be authorized' });
      }
      if (plan.mode === 'OWNER_BYPASS') {
        if (!auth.hasPermission(authenticated.user, 'coden.owner-bypass')) return json(res, 403, { error:'Owner role required.' });
        if (authenticated.session.elevatedUntil < Date.now()) return json(res, 403, { error:'Recent strong reauthentication is required.' });
      }
      // SEC-003 · destructive_action_confirmation. The consent scope was previously
      // copied onto the stored approval unvalidated, so `DENY` — the plan's own refusal
      // option — minted an approval, an invented scope was stored verbatim, and a
      // recursive delete could be granted a standing unattended licence. The scope is
      // checked against the recomputed plan, so Owner Bypass does not relax it either.
      const scopeRefusal = checkConsentScope(plan, request.consentScope);
      if (scopeRefusal) {
        ledger.append({ actor:authenticated.user.id, action:'coden.authorize', result:'refused', details:{ canonicalPath:plan.canonicalPath, mode:plan.mode, requestedScope:String(request.consentScope ?? ''), reason:scopeRefusal.error } });
        return json(res, scopeRefusal.status, { error:scopeRefusal.error });
      }
      const approval = {
        id:randomUUID(),
        actorId:authenticated.user.id,
        createdAt:new Date().toISOString(),
        expiresAt:new Date(Date.now() + Math.min(Number(request.durationMinutes ?? 15), 60) * 60000).toISOString(),
        consentScope:request.consentScope,
        mode:plan.mode,
        canonicalPath:plan.canonicalPath,
        operation:plan.operation,
        nonBypassableInvariants:plan.nonBypassableInvariants,
      };
      store.addApproval(approval);
      ledger.append({ actor:authenticated.user.id, action:'coden.authorize', result:'approved', details:{ id:approval.id, scope:approval.consentScope, path:approval.canonicalPath, mode:approval.mode } });
      return json(res, 201, approval);
    }
    // AI workspace: Ask / Create / Act, versioned context graph and explicit provider control.
    if (req.method === 'GET' && url.pathname === '/api/v1/ai/bootstrap') {
      const authenticated = requireSession(req, res, 'workspace.read'); if (!authenticated) return;
      return json(res, 200, { modes:['ASK','CREATE','ACT'], providerCatalog:providerGateway.catalog(), ...aiWorkspace.snapshot() });
    }
    // --- the reasoning seam · phase 1 -----------------------------------------
    // The provider is the only road to a plan. It is reported and exercised here so that
    // FOSS_CORE_DEPENDS_ON_ATOM = false is a property of the installation someone runs,
    // not of a crate in the repository. The Rust reference provider is the canonical
    // candidate and is not compiled into this image — the same position the Rust authority
    // daemon already holds — and both sides answer to conformance/reasoning-vectors.json.
    if (req.method === 'GET' && url.pathname === '/api/v1/reasoning') {
      const authenticated = requireSession(req, res); if (!authenticated) return;
      // The status describes configuration only. Probing the endpoint here would make a
      // status read do network I/O and report a liveness it cannot promise a moment later.
      return json(res, 200, { ...reasoningStatus(), routing: routingFrom() });
    }
    if (req.method === 'POST' && url.pathname === '/api/v1/reasoning/plan') {
      const authenticated = requireSession(req, res); if (!authenticated) return;
      if (!auth.hasPermission(authenticated.user, 'workspace.read')) {
        return json(res, 403, { error:'forbidden', requiredPermission:'workspace.read' });
      }
      const request = await body(req);
      try {
        // F4-016: PRODUCT.workspaceRoot was never defined, so this always evaluated to the
        // literal string '/workspace' regardless of NOESAR_WORKSPACE — harmless while the
        // two happen to coincide (every deployment so far), silently wrong the moment they
        // don't. `workspace` is the same module-level constant shadow.mjs and repo-map.mjs
        // already use for exactly this reason.
        // The router is the reference provider unless the environment says otherwise: with no
        // configuration every surface below answers exactly as it did before it existed.
        const provider = new ReasoningRouter({ workspaceRoot: workspace });
        const intent = await provider.interpret(String(request?.request ?? ''), request?.projectRules ?? []);
        const hypotheses = await provider.hypothesize(intent, []);
        const plan = await provider.plan(hypotheses, request?.constraints ?? [], request?.mode ?? 'safe');
        const constrained = await provider.constrain(plan, request?.policy ?? 'restrictive');
        const risk = await provider.classify(plan);
        const confidence = await provider.confidence(plan, []);
        // `expect` refuses a plan that could not turn out to be false. That refusal is a
        // real answer about this plan, not an error, so it is reported in place instead of
        // failing the whole request.
        let expectation = null;
        let expectationRefused = null;
        try {
          expectation = await provider.expect(constrained.refused ? plan : constrained.plan);
        } catch (error) {
          if (!(error instanceof ReasoningRefused)) throw error;
          expectationRefused = error.reason;
        }
        return json(res, 200, {
          provider:provider.identity(), intent, hypotheses, plan,
          constrained, risk, confidence, expectation, expectationRefused,
          // Which provider answered which surface. Without it an answer from a selected
          // external provider is indistinguishable from one produced here.
          provenance: provider.provenance(),
          routing: provider.routing,
        });
      } catch (error) {
        if (error instanceof ReasoningRefused) {
          return json(res, 422, { error:'reasoning_refused', reason:error.reason });
        }
        // A selected provider that cannot be reached is not a refusal, and is not answered by
        // quietly using a different one: the caller asked for that provider.
        if (error instanceof ReasoningUnavailable) {
          return json(res, 503, {
            error:'reasoning_unavailable', reason:error.reason,
            surface:error.surface, endpoint:error.endpoint,
          });
        }
        throw error;
      }
    }

    // --- research gate · UI-090…UI-096 ------------------------------------------------
    // Classifies a query's intent and effect BEFORE it would reach the open web
    // (`docs/WEBUI_DESIGN_V3.md` §Ricerca, `D-0142`: the gate is built before the surface
    // that would emit a query, on purpose — a Research destination with no gate in front of
    // it would be a way out to the network with nothing classifying what leaves). No
    // reference fallback: `research-gate.mjs`'s own module comment states why — the
    // reference reasoning provider has no model, the same boundary `workspace-actions.mjs`
    // already draws for the plan surfaces. If atomd or the model behind it is unreachable,
    // the answer is 503, never a guessed direction.
    if (req.method === 'GET' && url.pathname === '/api/v1/research/gate') {
      const authenticated = requireSession(req, res); if (!authenticated) return;
      // Configuration only, like `/api/v1/reasoning`: probing the endpoint here would make a
      // status read do network I/O and report a liveness it cannot promise a moment later.
      const endpoint = String(process.env.NOESAR_RUST_REASONING_ENDPOINT ?? '').trim();
      return json(res, 200, { configured: Boolean(endpoint) });
    }
    if (req.method === 'POST' && url.pathname === '/api/v1/research/gate') {
      const authenticated = requireSession(req, res); if (!authenticated) return;
      if (!auth.hasPermission(authenticated.user, 'workspace.read')) {
        return json(res, 403, { error:'forbidden', requiredPermission:'workspace.read' });
      }
      // This route writes nothing, but D-0193/D-0194 found the same missing-CSRF gap twice
      // on routes that DO write; it triggers a real outbound network call to atomd on the
      // caller's behalf, which is reason enough not to make it a third.
      if (!requireCsrf(req, res, authenticated)) return;
      const payload = await body(req);
      const query = typeof payload?.query === 'string' ? payload.query.trim() : '';
      if (!query) return json(res, 400, { error:'invalid_query', reason:'query must be a non-empty string' });
      try {
        const client = researchGateFrom(process.env);
        const decision = await client.classify(query);
        // The query text itself is not recorded — `privacy.mjs`'s declared states govern
        // what a person searched for, not this ledger; the outcome and category are the
        // decision, and a decision is what the ledger already records elsewhere.
        ledger.append({ actor:authenticated.user.id, action:'research.gated', result:decision.outcome.toLowerCase(), details:{ category:decision.category } });
        // UI-095: a refusal carries no field a caller could mistake for something to search
        // with — the query is echoed back only on the branch where it may still be used.
        if (decision.outcome === 'REFUSE') {
          return json(res, 200, { outcome:'REFUSE', category:decision.category });
        }
        return json(res, 200, { outcome:decision.outcome, query });
      } catch (error) {
        if (error instanceof ReasoningUnavailable) {
          return json(res, 503, {
            error:'reasoning_unavailable', reason:error.reason,
            surface:error.surface, endpoint:error.endpoint,
          });
        }
        throw error;
      }
    }

    // --- research provider designation · Settings ---------------------------------
    // Which registered external tool (agent-service.mjs) the Ricerca destination is allowed
    // to call. Deliberately reuses the tools/consent machinery already built rather than a
    // parallel credential store — consenting a tool here already makes it disclosed by
    // privacy.mjs (UI-089), with no privacy code added by this feature.
    if (req.method === 'GET' && url.pathname === '/api/v1/settings/research') {
      const authenticated = requireSession(req, res, 'workspace.read'); if (!authenticated) return;
      const state = aiStore.read();
      const toolId = state.settings?.researchProviderToolId ?? null;
      const tool = toolId ? (state.tools ?? []).find((item) => item.id === toolId) ?? null : null;
      return json(res, 200, {
        toolId,
        configured: Boolean(tool),
        consented: Boolean(tool?.external && tool?.consent?.granted),
        eligibleTools: (state.tools ?? []).filter((item) => item.external).map((item) => ({ id:item.id, name:item.name, consented:Boolean(item.consent?.granted) })),
      });
    }
    if (req.method === 'PUT' && url.pathname === '/api/v1/settings/research') {
      const authenticated = requireSession(req, res, 'provider.manage');
      if (!authenticated || !requireCsrf(req, res, authenticated)) return;
      const request = await body(req);
      const toolId = request.toolId === null ? null : String(request.toolId ?? '').trim() || null;
      if (toolId) {
        const tool = (aiStore.read().tools ?? []).find((item) => item.id === toolId);
        if (!tool) return json(res, 404, { error:'No such tool.' });
        if (!tool.external) return json(res, 400, { error:'The research provider must be an external tool.' });
      }
      const updated = aiStore.transact((state) => { state.settings ??= {}; state.settings.researchProviderToolId = toolId; return { researchProviderToolId:toolId }; });
      ledger.append({ actor:authenticated.user.id, action:'research.provider-designated', result:'success', details:updated });
      return json(res, 200, updated);
    }

    // D-0275: the ad-hoc external-link module mechanism D-0273 built here
    // (GET/PUT /api/v1/settings/modules[/:id], modules-registry.mjs) is retired now that
    // the real sector-modules activation framework (D-0274) exists to replace it — see
    // docs/DECISION_LOG.md D-0275. modules-registry.mjs itself is left on disk, unimported,
    // per CLAUDE10.md rule 12 (no deletion without an explicit Owner amendment, the same
    // process D-0195 used for apps/webui-react/).

    // --- research report · UI-080…089 ----------------------------------------------
    // The other half of the gate above: intent PROCEED → the designated provider tool →
    // content gate → an ephemeral, session-gated, revocable report. See research.mjs's own
    // module comment for why there is no built-in provider and why the store is in-memory.
    if (req.method === 'POST' && url.pathname === '/api/v1/research/report') {
      const authenticated = requireSession(req, res); if (!authenticated) return;
      if (!auth.hasPermission(authenticated.user, 'workspace.read')) {
        return json(res, 403, { error:'forbidden', requiredPermission:'workspace.read' });
      }
      if (!requireCsrf(req, res, authenticated)) return;
      const request = await body(req);
      const state = aiStore.read();
      try {
        const outcome = await runResearchReport({
          objective: request.objective, criteria: request.criteria,
          actorId: authenticated.user.id, projectId: request.projectId ?? null,
          gate: researchGateFrom(process.env), tools: state.tools ?? [], executor: toolExecutor,
          toolId: state.settings?.researchProviderToolId ?? null,
          ledger, reportStore: researchReportStore, refusalRegistry: researchRefusalRegistry,
        });
        if (outcome.outcome === 'PROCEED') {
          return json(res, 200, { outcome:'PROCEED', reportId:outcome.report.id, expiresAt:outcome.report.expiresAt });
        }
        return json(res, 200, outcome);
      } catch (error) {
        if (error instanceof ReasoningUnavailable) {
          return json(res, 503, { error:'reasoning_unavailable', reason:error.reason, surface:error.surface, endpoint:error.endpoint });
        }
        if (Number.isInteger(error.status)) return json(res, error.status, { error:error.kind ?? 'research_failed', reason:error.message });
        throw error;
      }
    }
    const researchReportMatch = url.pathname.match(/^\/api\/v1\/research\/report\/([^/]+)$/);
    if (researchReportMatch && req.method === 'GET') {
      // UI-082: a session on THIS installation is required — the link is not public of its
      // own accord. Sharing it further is a separate act with its own warning (undecided,
      // not built here — see docs/WEBUI_DESIGN_V3.md §19's own open item).
      const authenticated = requireSession(req, res, 'workspace.read'); if (!authenticated) return;
      const report = researchReportStore.get(researchReportMatch[1]);
      if (!report) return json(res, 404, { error:'This report link no longer works — it may have expired, been revoked, or never existed.' });
      return json(res, 200, report);
    }
    const researchRevokeMatch = url.pathname.match(/^\/api\/v1\/research\/report\/([^/]+)\/revoke$/);
    if (researchRevokeMatch && req.method === 'POST') {
      const authenticated = requireSession(req, res, 'workspace.write');
      if (!authenticated || !requireCsrf(req, res, authenticated)) return;
      const revoked = researchReportStore.revoke(researchRevokeMatch[1], { actorId:authenticated.user.id });
      if (!revoked) return json(res, 404, { error:'This report link no longer works.' });
      ledger.append({ actor:authenticated.user.id, action:'research.report-revoked', result:'success', details:{ reportId:researchRevokeMatch[1] } });
      return json(res, 200, { revoked:true });
    }
    // UI-096: the contestation is registered, not auto-resolved — the far side of it is a
    // human review, out of this route's scope.
    if (req.method === 'POST' && url.pathname === '/api/v1/research/gate/contest') {
      const authenticated = requireSession(req, res); if (!authenticated) return;
      if (!requireCsrf(req, res, authenticated)) return;
      const request = await body(req);
      try {
        const contested = researchRefusalRegistry.contest(String(request.refusalId ?? ''), { note:request.note, actorId:authenticated.user.id });
        ledger.append({ actor:authenticated.user.id, action:'research.gate-contested', result:'recorded', details:{ refusalId:contested.id, category:contested.category } });
        return json(res, 200, { contested:true });
      } catch (error) {
        if (Number.isInteger(error.status)) return json(res, error.status, { error:error.kind ?? 'contest_failed', reason:error.message });
        throw error;
      }
    }

    // --- repository understanding · phase 1 step 7, the last of the backbone -----
    // Read-only: a real tree in, five reports out (09_PIANO.md §2 step 7). No Rust twin —
    // see the module comment in repo-map.mjs — because this proposes and presents, it does
    // not decide or confine anything on what it finds. Workspace-scoped: an optional `path`
    // is a subdirectory of the product workspace, never an arbitrary host path, the same
    // boundary path-auth.mjs already draws for writes.
    if (req.method === 'GET' && url.pathname === '/api/v1/repo-map') {
      const authenticated = requireSession(req, res); if (!authenticated) return;
      return json(res, 200, repoMapStatus());
    }
    if (req.method === 'POST' && url.pathname === '/api/v1/repo-map/scan') {
      const authenticated = requireSession(req, res); if (!authenticated) return;
      if (!auth.hasPermission(authenticated.user, 'workspace.read')) {
        return json(res, 403, { error:'forbidden', requiredPermission:'workspace.read' });
      }
      const payload = await body(req);
      const root = workspace;
      const target = resolveWorkspaceSubpath(root, payload?.path);
      if (!target) return json(res, 400, { error:'invalid_path', reason:'path escapes the workspace' });
      try {
        const map = buildRepositoryMap(target);
        ledger.append({ actor:authenticated.user.id, action:'repo_map.scanned', result:'success', details:{ path:payload?.path ?? '.', filesScanned:map.filesScanned, truncated:map.truncated } });
        return json(res, 200, map);
      } catch (error) {
        if (error instanceof RepoMapError) return json(res, 422, { error:'repo_map_refused', kind:error.kind, reason:error.reason });
        throw error;
      }
    }
    if (req.method === 'GET' && url.pathname === '/api/v1/repo-map/search') {
      const authenticated = requireSession(req, res); if (!authenticated) return;
      if (!auth.hasPermission(authenticated.user, 'workspace.read')) {
        return json(res, 403, { error:'forbidden', requiredPermission:'workspace.read' });
      }
      const root = workspace;
      const target = resolveWorkspaceSubpath(root, url.searchParams.get('path'));
      if (!target) return json(res, 400, { error:'invalid_path', reason:'path escapes the workspace' });
      const q = url.searchParams.get('q') ?? '';
      try {
        const found = literalSearch(target, q, { caseSensitive:url.searchParams.get('caseSensitive') !== 'false' });
        ledger.append({ actor:authenticated.user.id, action:'repo_map.searched', result:'success', details:{ path:url.searchParams.get('path') ?? '.', matches:found.matches.length, truncated:found.truncated } });
        return json(res, 200, found);
      } catch (error) {
        if (error instanceof RepoMapError) return json(res, 422, { error:'repo_map_refused', kind:error.kind, reason:error.reason });
        throw error;
      }
    }

    // --- sector modules · phase 7 step 27 ("il mondo esterno", 09_PIANO.md §2) ---------
    // Read-only: validates and lists candidate manifests against the schema and the two
    // policy files under capabilities/security/ -- tracked since 2026-07-25, never wired
    // until this step (see the module comment in sector-modules.mjs). No Rust twin, same
    // reason as repo-map: this proposes, it does not decide or confine anything yet.
    if (req.method === 'GET' && url.pathname === '/api/v1/sector-modules') {
      const authenticated = requireSession(req, res); if (!authenticated) return;
      return json(res, 200, sectorModulesStatus(repoRoot, sectorModulesRoot));
    }
    if (req.method === 'GET' && url.pathname === '/api/v1/sector-modules/list') {
      const authenticated = requireSession(req, res); if (!authenticated) return;
      if (!auth.hasPermission(authenticated.user, 'workspace.read')) {
        return json(res, 403, { error:'forbidden', requiredPermission:'workspace.read' });
      }
      try {
        const scan = loadSectorModules(repoRoot, sectorModulesRoot);
        ledger.append({ actor:authenticated.user.id, action:'sector_modules.scanned', result:'success', details:{ scanned:scan.scanned, valid:scan.valid.length, invalid:scan.invalid.length, truncated:scan.truncated } });
        return json(res, 200, scan);
      } catch (error) {
        if (error instanceof SectorModuleError) return json(res, 422, { error:'sector_modules_refused', kind:error.kind, reason:error.reason });
        throw error;
      }
    }
    if (req.method === 'POST' && url.pathname === '/api/v1/sector-modules/validate') {
      const authenticated = requireSession(req, res); if (!authenticated) return;
      if (!auth.hasPermission(authenticated.user, 'workspace.read')) {
        return json(res, 403, { error:'forbidden', requiredPermission:'workspace.read' });
      }
      const payload = await body(req);
      try {
        const result = validateCandidateManifest(repoRoot, payload ?? {});
        ledger.append({ actor:authenticated.user.id, action:'sector_modules.validated', result: result.valid ? 'success' : 'refused', details:{ valid:result.valid, errorCount:result.errors.length } });
        return json(res, 200, result);
      } catch (error) {
        if (error instanceof SectorModuleError) return json(res, 422, { error:'sector_modules_refused', kind:error.kind, reason:error.reason });
        throw error;
      }
    }

    // --- sector modules · activation (D-0274) ------------------------------------------
    // Owner-only (same convention as /api/v1/updates/*: audit.read is the marker
    // permission, not a new RBAC token — ARCH-007's static extractor sees nothing new).
    // Each route requires a capabilityToken already minted through
    // POST /api/v1/adapters/sector-modules/grants -> .../approve (ARCH-005) — these
    // functions spend it, they do not mint it. Activating a high-risk module additionally
    // requires the session's own recent strong reauthentication, checked here (a
    // session-scoped fact sector-modules.mjs cannot see) by peeking the manifest's own
    // declared risk with readInstalledManifest()+classifyModuleRisk() before deciding.
    if (req.method === 'POST' && url.pathname === '/api/v1/sector-modules/install') {
      const authenticated = requireOwner(req, res, 'audit.read');
      if (!authenticated || !requireCsrf(req, res, authenticated)) return;
      const payload = await body(req);
      const nowUnix = Math.floor(Date.now() / 1000);
      try {
        const result = installSectorModule({
          productRoot: repoRoot, sectorModulesRoot, id: payload?.id, candidate: payload?.manifest,
          minter: capabilityMinter, capabilityToken: payload?.capabilityToken ?? null, nowUnix,
        });
        ledger.append({ actor:authenticated.user.id, action:'sector_modules.installed', result:'success', details:{ id:result.id } });
        reconcileModuleWiring({ listen: true });
        return json(res, 201, result);
      } catch (error) {
        if (error instanceof SectorModuleError) {
          ledger.append({ actor:authenticated.user.id, action:'sector_modules.install_refused', result:'refused', details:{ id:payload?.id, kind:error.kind } });
          return json(res, error.kind === 'ALREADY_INSTALLED' ? 409 : 422, { error:'sector_modules_refused', kind:error.kind, reason:error.reason });
        }
        throw error;
      }
    }
    if (req.method === 'POST' && url.pathname === '/api/v1/sector-modules/activate') {
      const authenticated = requireOwner(req, res, 'audit.read');
      if (!authenticated || !requireCsrf(req, res, authenticated)) return;
      const payload = await body(req);
      const nowUnix = Math.floor(Date.now() / 1000);
      const candidate = payload?.id ? readInstalledManifest(sectorModulesRoot, payload.id) : null;
      if (candidate && classifyModuleRisk(candidate).highRisk && authenticated.session.elevatedUntil < Date.now()) {
        return json(res, 403, { error:'Recent strong reauthentication is required to activate a high-risk sector module.' });
      }
      try {
        // D-0275: the single-key env-var lookup this route used to do is gone -- a
        // high-risk manifest's signature is now checked against the trusted publisher
        // registry (publisherRegistry.findActiveKey(), inside activateSectorModule()).
        const result = activateSectorModule({
          productRoot: repoRoot, sectorModulesRoot, id: payload?.id,
          minter: capabilityMinter, capabilityToken: payload?.capabilityToken ?? null,
          approverId: authenticated.user.id, nowUnix, publisherRegistry,
        });
        ledger.append({ actor:authenticated.user.id, action:'sector_modules.activated', result:'success', details:{ id:result.id, highRisk:result.highRisk, trustLevel:result.trustLevel } });
        reconcileModuleWiring({ listen: true });
        return json(res, 200, result);
      } catch (error) {
        if (error instanceof SectorModuleError) {
          ledger.append({ actor:authenticated.user.id, action:'sector_modules.activate_refused', result:'refused', details:{ id:payload?.id, kind:error.kind } });
          return json(res, error.kind === 'NOT_FOUND' ? 404 : 422, { error:'sector_modules_refused', kind:error.kind, reason:error.reason });
        }
        throw error;
      }
    }
    if (req.method === 'POST' && url.pathname === '/api/v1/sector-modules/deactivate') {
      const authenticated = requireOwner(req, res, 'audit.read');
      if (!authenticated || !requireCsrf(req, res, authenticated)) return;
      const payload = await body(req);
      const nowUnix = Math.floor(Date.now() / 1000);
      try {
        const result = deactivateSectorModule({
          sectorModulesRoot, id: payload?.id, minter: capabilityMinter,
          capabilityToken: payload?.capabilityToken ?? null, approverId: authenticated.user.id,
          nowUnix, reason: payload?.reason ?? null,
        });
        ledger.append({ actor:authenticated.user.id, action:'sector_modules.deactivated', result:'success', details:{ id:result.id } });
        reconcileModuleWiring({ listen: true });
        return json(res, 200, result);
      } catch (error) {
        if (error instanceof SectorModuleError) {
          ledger.append({ actor:authenticated.user.id, action:'sector_modules.deactivate_refused', result:'refused', details:{ id:payload?.id, kind:error.kind } });
          return json(res, error.kind === 'NOT_FOUND' ? 404 : 422, { error:'sector_modules_refused', kind:error.kind, reason:error.reason });
        }
        throw error;
      }
    }

    // --- owner module catalog (D-0277) ---------------------------------------------------
    // One click instead of the seven-call register/sign/mint/install/mint/activate
    // sequence a human would otherwise have to drive through the raw D-0274/D-0275
    // routes above -- the server performs registration and signing on the Owner's behalf,
    // it does not ask them to paste a PEM around. Fixed catalog (OWNER_MODULE_CATALOG):
    // these routes mint manifests ONLY for ids listed there, never an arbitrary one.
    if (req.method === 'GET' && url.pathname === '/api/v1/sector-modules/catalog') {
      const authenticated = requireSession(req, res, 'workspace.read'); if (!authenticated) return;
      const scan = loadSectorModules(repoRoot, sectorModulesRoot);
      const entries = OWNER_MODULE_CATALOG.map((entry) => {
        const installed = scan.valid.find((candidate) => candidate.id === entry.id);
        // D-0278 graphics pass: version/publisher/trustLevel/sector are read straight off
        // the same manifest install/activate sign — never a second, independently
        // maintained copy of this metadata for display purposes only.
        const manifest = entry.buildManifest();
        // D-0281: entry.externalUrl was a direct LAN address, dead since the module
        // moved off the LAN-published network (it has no auth of its own to protect it
        // if it stayed there). Where a proxy exists for this module, the reachable
        // address is NOESAR's own publish address on the proxy port instead — same
        // bindAddress the operator already published NOESAR on, never a second one to
        // configure. Falls back to the catalog's declared URL when no proxy is running
        // (module not configured) or no publish address is known, rather than hiding
        // the field.
        const proxiedUrl = entry.id === 'debug-evolution' && moduleConsoleProxyConfigured && bindAddress && !isWildcardAddress(bindAddress)
          ? `${tls.active ? 'https' : 'http'}://${bindAddress}:${moduleConsoleProxyPort}`
          : entry.externalUrl;
        // D-0283: an uninstalled module keeps its manifest on disk (it is the audit
        // evidence of what was once trusted here), so `scan.valid` still finds it — the
        // catalog reports it as installable again, which is what an Owner looking at the
        // card needs to know. `state.status` itself stays `uninstalled` for an audit read.
        const lifecycle = installed ? installed.state.status : 'not-installed';
        return {
          id: entry.id, name: entry.name, description: entry.description, externalUrl: proxiedUrl,
          status: lifecycle === 'uninstalled' ? 'not-installed' : lifecycle,
          version: manifest.version, publisher: manifest.publisher, trustLevel: manifest.trust_level,
          sector: manifest.sector,
        };
      });
      return json(res, 200, { modules: entries });
    }
    const catalogInstallMatch = url.pathname.match(/^\/api\/v1\/sector-modules\/catalog\/([^/]+)\/install$/);
    if (catalogInstallMatch && req.method === 'POST') {
      // D-0278: owner+CSRF only, no separate strong-reauth step — Owner instruction,
      // verbatim: "togliere autentificazione dai moduli basta solo quella di noesar,
      // altrimenti 10 autorizzazioni per moduli". The Owner catalog is a small,
      // NOESAR-controlled allowlist (findCatalogEntry below), signed with a key this
      // process holds and never exposes — the risk a step-up reauth defends against
      // (a stolen session installing an ARBITRARY untrusted manifest) does not apply
      // the same way here, unlike the raw D-0274/D-0275 routes above, which keep it.
      const authenticated = requireOwner(req, res, 'audit.read');
      if (!authenticated || !requireCsrf(req, res, authenticated)) return;
      const id = decodeURIComponent(catalogInstallMatch[1]);
      const entry = findCatalogEntry(id);
      if (!entry) return json(res, 404, { error:'No such catalog module.' });
      const nowUnix = Math.floor(Date.now() / 1000);
      try {
        const privateKeyPem = ensureOwnerPublisherRegistered({ actorId: authenticated.user.id, nowUnix });
        const manifest = signSectorModuleManifest(entry.buildManifest(), privateKeyPem);
        const granted = adapterGrants.request({ resource:'sector-modules', operation:'WRITE', actor:authenticated.user.id, nowUnix });
        const approved = adapterGrants.approve({ runId:granted.runId, approverId:authenticated.user.id, nowUnix });
        const result = installSectorModule({
          productRoot: repoRoot, sectorModulesRoot, id, candidate: manifest,
          minter: capabilityMinter, capabilityToken: approved.token, nowUnix,
        });
        ledger.append({ actor:authenticated.user.id, action:'sector_modules.catalog_installed', result:'success', details:{ id } });
        reconcileModuleWiring({ listen: true });
        return json(res, 201, result);
      } catch (error) {
        if (error instanceof SectorModuleError) {
          ledger.append({ actor:authenticated.user.id, action:'sector_modules.catalog_install_refused', result:'refused', details:{ id, kind:error.kind } });
          return json(res, error.kind === 'ALREADY_INSTALLED' ? 409 : 422, { error:'sector_modules_refused', kind:error.kind, reason:error.reason });
        }
        throw error;
      }
    }
    const catalogActivateMatch = url.pathname.match(/^\/api\/v1\/sector-modules\/catalog\/([^/]+)\/activate$/);
    if (catalogActivateMatch && req.method === 'POST') {
      // D-0278: same reasoning as install() above — owner+CSRF only.
      const authenticated = requireOwner(req, res, 'audit.read');
      if (!authenticated || !requireCsrf(req, res, authenticated)) return;
      const id = decodeURIComponent(catalogActivateMatch[1]);
      if (!findCatalogEntry(id)) return json(res, 404, { error:'No such catalog module.' });
      const nowUnix = Math.floor(Date.now() / 1000);
      try {
        const granted = adapterGrants.request({ resource:'sector-modules', operation:'WRITE', actor:authenticated.user.id, nowUnix });
        const approved = adapterGrants.approve({ runId:granted.runId, approverId:authenticated.user.id, nowUnix });
        const result = activateSectorModule({
          productRoot: repoRoot, sectorModulesRoot, id, minter: capabilityMinter,
          capabilityToken: approved.token, approverId: authenticated.user.id, nowUnix, publisherRegistry,
        });
        ledger.append({ actor:authenticated.user.id, action:'sector_modules.catalog_activated', result:'success', details:{ id } });
        // D-0283: the tools, the credential and the console proxy come up HERE, on the
        // activation, not at boot off an environment variable — that is what makes a
        // one-click install a real install and a one-click uninstall a real removal.
        reconcileModuleWiring({ listen: true });
        return json(res, 200, result);
      } catch (error) {
        if (error instanceof SectorModuleError) {
          ledger.append({ actor:authenticated.user.id, action:'sector_modules.catalog_activate_refused', result:'refused', details:{ id, kind:error.kind } });
          return json(res, error.kind === 'NOT_FOUND' ? 404 : 422, { error:'sector_modules_refused', kind:error.kind, reason:error.reason });
        }
        throw error;
      }
    }
    const catalogDeactivateMatch = url.pathname.match(/^\/api\/v1\/sector-modules\/catalog\/([^/]+)\/deactivate$/);
    if (catalogDeactivateMatch && req.method === 'POST') {
      const authenticated = requireOwner(req, res, 'audit.read');
      if (!authenticated || !requireCsrf(req, res, authenticated)) return;
      const id = decodeURIComponent(catalogDeactivateMatch[1]);
      if (!findCatalogEntry(id)) return json(res, 404, { error:'No such catalog module.' });
      const nowUnix = Math.floor(Date.now() / 1000);
      try {
        const granted = adapterGrants.request({ resource:'sector-modules', operation:'WRITE', actor:authenticated.user.id, nowUnix });
        const approved = adapterGrants.approve({ runId:granted.runId, approverId:authenticated.user.id, nowUnix });
        const result = deactivateSectorModule({
          sectorModulesRoot, id, minter: capabilityMinter, capabilityToken: approved.token,
          approverId: authenticated.user.id, nowUnix,
        });
        ledger.append({ actor:authenticated.user.id, action:'sector_modules.catalog_deactivated', result:'success', details:{ id } });
        reconcileModuleWiring({ listen: true });
        return json(res, 200, result);
      } catch (error) {
        if (error instanceof SectorModuleError) {
          ledger.append({ actor:authenticated.user.id, action:'sector_modules.catalog_deactivate_refused', result:'refused', details:{ id, kind:error.kind } });
          return json(res, error.kind === 'NOT_FOUND' ? 404 : 422, { error:'sector_modules_refused', kind:error.kind, reason:error.reason });
        }
        throw error;
      }
    }
    // D-0283: the verb the Owner asked for and the product did not have. Owner instruction
    // (s302), verbatim: "disinstallare debug evolution deve lasciare noesar intatto".
    // Same gate as the other three catalog routes (owner + CSRF, no separate step-up:
    // removing a module is a de-escalation, and D-0278's argument against a second prompt
    // applies with more force here than on install).
    const catalogUninstallMatch = url.pathname.match(/^\/api\/v1\/sector-modules\/catalog\/([^/]+)\/uninstall$/);
    if (catalogUninstallMatch && req.method === 'POST') {
      const authenticated = requireOwner(req, res, 'audit.read');
      if (!authenticated || !requireCsrf(req, res, authenticated)) return;
      const id = decodeURIComponent(catalogUninstallMatch[1]);
      if (!findCatalogEntry(id)) return json(res, 404, { error:'No such catalog module.' });
      const nowUnix = Math.floor(Date.now() / 1000);
      try {
        const granted = adapterGrants.request({ resource:'sector-modules', operation:'WRITE', actor:authenticated.user.id, nowUnix });
        const approved = adapterGrants.approve({ runId:granted.runId, approverId:authenticated.user.id, nowUnix });
        const result = uninstallSectorModule({
          sectorModulesRoot, id, minter: capabilityMinter, capabilityToken: approved.token,
          approverId: authenticated.user.id, nowUnix, reason: 'owner uninstalled from the module catalog',
        });
        // The state file is written first and the wiring is taken down second, deliberately:
        // if this process died between the two, the next boot's reconcile reads the same
        // state and finishes the teardown. The reverse order could leave a module marked
        // installed with no tools, which nothing would ever repair.
        const wiring = reconcileModuleWiring({ listen: true });
        ledger.append({ actor:authenticated.user.id, action:'sector_modules.catalog_uninstalled', result:'success', details:{ id, wasActive:result.wasActive, toolsDetached:wiring.tools.detached.length } });
        return json(res, 200, { ...result, toolsDetached: wiring.tools.detached, proxyListening: wiring.proxyListening });
      } catch (error) {
        if (error instanceof SectorModuleError) {
          ledger.append({ actor:authenticated.user.id, action:'sector_modules.catalog_uninstall_refused', result:'refused', details:{ id, kind:error.kind } });
          return json(res, error.kind === 'NOT_FOUND' ? 404 : 422, { error:'sector_modules_refused', kind:error.kind, reason:error.reason });
        }
        throw error;
      }
    }

    // --- Debug Evolution bridge (D-0278) ------------------------------------------------
    // The three read-only tools (list projects / all findings / SARIF) are registered as
    // plain Agents/Workflows tools (reconcileDebugEvolutionTools() above) and need no route
    // of their own — the generic tool executor calls Debug Evolution's real API directly.
    // Triggering a fresh scan is the one action that needs a bridge: Debug Evolution's own
    // rebuild endpoint takes one project id in the URL path, which the generic
    // fixed-endpoint tool model cannot parametrise per call, so this is a direct owner
    // action instead — sequential over all 14 already-registered NOESAR EVOLUTION areas.
    if (req.method === 'POST' && url.pathname === '/api/v1/debug-evolution/rescan') {
      const authenticated = requireOwner(req, res, 'audit.read');
      if (!authenticated || !requireCsrf(req, res, authenticated)) return;
      // D-0283: this bridge reads the module's URL and token from the environment, which
      // outlives the module — the install state is what decides whether it may run at all.
      if (!isModuleActive(sectorModulesRoot, DEBUG_EVOLUTION_MODULE_ID)) {
        return json(res, 409, { error:'The Debug Evolution module is not active on this installation.' });
      }
      try {
        const result = await rescanNoesarEvolutionProjects();
        ledger.append({ actor:authenticated.user.id, action:'debug_evolution.rescanned', result:'success', details:{ rescanned:result.rescanned, succeeded:result.succeeded } });
        return json(res, 200, result);
      } catch (error) {
        if (error.status) return json(res, error.status, { error:error.message });
        throw error;
      }
    }

    // D-0284: Phase 2, first slice — discovery+skeptic. Manual trigger, same posture as
    // rescan above and for the same reason (cost/latency per finding not yet measured on
    // this deployment — "misura prima, ottimizza dopo"). `hypothesize()`/`evidence()` are
    // already in `NOESAR_EXTERNAL_SURFACES` on this deployment, so the router below reaches
    // the real ATOM sidecar with no new configuration; see debug-evolution-triage.mjs's
    // header for why those two surfaces and not classify/confidence/expect.
    // D-0293: one finding on demand. Separate from the sweep below, not a parameter of it —
    // `debug-evolution-bridge.mjs`'s `triageFindingById` explains why the sweep is the wrong
    // instrument for a single verdict (it only sees DETECTED, and it would wake ATOM on
    // every other finding in the installation).
    const triageOneMatch = url.pathname.match(/^\/api\/v1\/debug-evolution\/findings\/([^/]+)\/triage$/);
    if (triageOneMatch && req.method === 'POST') {
      const authenticated = requireOwner(req, res, 'audit.read');
      if (!authenticated || !requireCsrf(req, res, authenticated)) return;
      if (!isModuleActive(sectorModulesRoot, DEBUG_EVOLUTION_MODULE_ID)) {
        return json(res, 409, { error:'The Debug Evolution module is not active on this installation.' });
      }
      const findingId = decodeURIComponent(triageOneMatch[1]);
      try {
        const router = new ReasoningRouter({ workspaceRoot: workspace });
        const result = await triageFindingById(findingId, router);
        ledger.append({ actor:authenticated.user.id, action:'debug_evolution.finding_triaged', result:'success',
                        details:{ findingId, evidenceAdded:result.evidenceAdded ?? 0, hypotheses:result.hypotheses ?? 0, state:result.state } });
        return json(res, 200, { ...result, provenance: router.provenance(), routing: router.routing });
      } catch (error) {
        if (error instanceof ReasoningRefused) return json(res, 422, { error:'reasoning_refused', reason:error.reason });
        if (error instanceof ReasoningUnavailable) return json(res, 503, { error:'reasoning_unavailable', reason:error.reason });
        if (error.status) return json(res, error.status, { error:error.message });
        throw error;
      }
    }
    if (req.method === 'POST' && url.pathname === '/api/v1/debug-evolution/triage') {
      const authenticated = requireOwner(req, res, 'audit.read');
      if (!authenticated || !requireCsrf(req, res, authenticated)) return;
      if (!isModuleActive(sectorModulesRoot, DEBUG_EVOLUTION_MODULE_ID)) {
        return json(res, 409, { error:'The Debug Evolution module is not active on this installation.' });
      }
      try {
        const router = new ReasoningRouter({ workspaceRoot: workspace });
        const result = await triageUnclassifiedFindings(router);
        ledger.append({ actor:authenticated.user.id, action:'debug_evolution.triaged', result:'success', details:{ triaged:result.triaged, succeeded:result.succeeded } });
        // `router.identity()` always answers for the reference provider (it derives from no
        // argument the router routes) -- `provenance()` is what actually says whether ATOM
        // or the reference provider answered `hypothesize` for this run.
        return json(res, 200, { ...result, provenance: router.provenance(), routing: router.routing });
      } catch (error) {
        if (error.status) return json(res, error.status, { error:error.message });
        if (error instanceof ReasoningRefused) return json(res, 422, { error:'reasoning_refused', reason:error.reason });
        if (error instanceof ReasoningUnavailable) {
          return json(res, 503, { error:'reasoning_unavailable', reason:error.reason, surface:error.surface, endpoint:error.endpoint });
        }
        throw error;
      }
    }

    // --- Debug Evolution remote targets (D-0286, Phase 3) -------------------------------
    // "Bersagli remoti via SSH, credenziali dal vault NOESAR, mai su disco nel modulo"
    // (Owner s302). Debug Evolution never sees a credential: NOESAR runs `ssh-keyscan` at
    // registration, `scp` at fetch time, and uploads the result to Debug Evolution's own
    // `POST /api/v2/projects/import` — the same "one authentication, and it is NOESAR's"
    // posture D-0280 set for the module's own service token, extended to SSH.
    if (req.method === 'GET' && url.pathname === '/api/v1/debug-evolution/remote-targets') {
      const authenticated = requireSession(req, res, 'workspace.read'); if (!authenticated) return;
      return json(res, 200, { targets: remoteTargetRegistry.list() });
    }
    // Step 1: capture the host's own public key via `ssh-keyscan` and store it alongside a
    // pending target record, before any credential exists for it. The fingerprint returned
    // here is what the Owner compares against what they already know about this host —
    // the FULL key, not just the fingerprint, is what actually gets verified later
    // (`remote-target-fetch.mjs`'s own header explains why the two are not interchangeable).
    if (req.method === 'POST' && url.pathname === '/api/v1/debug-evolution/remote-targets') {
      const authenticated = requireOwner(req, res, 'audit.read');
      if (!authenticated || !requireCsrf(req, res, authenticated)) return;
      const payload = await body(req);
      try {
        const { pinnedHostKey, fingerprint } = await keyscanHost({ host: payload?.host, port: payload?.port ?? 22 });
        const target = remoteTargetRegistry.createAwaitingKey({
          name: payload?.name, host: payload?.host, port: payload?.port ?? 22,
          username: payload?.username, remotePath: payload?.remotePath,
          pinnedHostKey, fingerprint,
        }, authenticated.user.id);
        return json(res, 201, target);
      } catch (error) {
        if (error instanceof RemoteTargetFetchError) return json(res, 502, { error: error.kind, reason: error.reason });
        if (error.status) return json(res, error.status, { error: error.message });
        throw error;
      }
    }
    const remoteTargetActivateMatch = url.pathname.match(/^\/api\/v1\/debug-evolution\/remote-targets\/([^/]+)\/activate$/);
    if (remoteTargetActivateMatch && req.method === 'POST') {
      const authenticated = requireOwner(req, res, 'audit.read');
      if (!authenticated || !requireCsrf(req, res, authenticated)) return;
      const payload = await body(req);
      try {
        const target = remoteTargetRegistry.activate(decodeURIComponent(remoteTargetActivateMatch[1]), payload?.privateKey, authenticated.user.id);
        return json(res, 200, target);
      } catch (error) {
        if (error.status) return json(res, error.status, { error: error.message });
        throw error;
      }
    }
    const remoteTargetRotateMatch = url.pathname.match(/^\/api\/v1\/debug-evolution\/remote-targets\/([^/]+)\/rotate-key$/);
    if (remoteTargetRotateMatch && req.method === 'POST') {
      const authenticated = requireOwner(req, res, 'audit.read');
      if (!authenticated || !requireCsrf(req, res, authenticated)) return;
      const payload = await body(req);
      try {
        const target = remoteTargetRegistry.rotateKey(decodeURIComponent(remoteTargetRotateMatch[1]), payload?.privateKey, authenticated.user.id);
        return json(res, 200, target);
      } catch (error) {
        if (error.status) return json(res, error.status, { error: error.message });
        throw error;
      }
    }
    const remoteTargetFetchMatch = url.pathname.match(/^\/api\/v1\/debug-evolution\/remote-targets\/([^/]+)\/fetch-and-scan$/);
    if (remoteTargetFetchMatch && req.method === 'POST') {
      const authenticated = requireOwner(req, res, 'audit.read');
      if (!authenticated || !requireCsrf(req, res, authenticated)) return;
      if (!isModuleActive(sectorModulesRoot, DEBUG_EVOLUTION_MODULE_ID)) {
        return json(res, 409, { error:'The Debug Evolution module is not active on this installation.' });
      }
      const id = decodeURIComponent(remoteTargetFetchMatch[1]);
      let target;
      try {
        target = remoteTargetRegistry.get(id);
      } catch (error) {
        return json(res, error.status ?? 500, { error: error.message });
      }
      try {
        const privateKeyPem = remoteTargetRegistry.resolveCredential(id);
        const result = await fetchAndScanRemoteTarget(target, privateKeyPem);
        const recorded = remoteTargetRegistry.recordFetch(id, { ok: true, projectId: result.projectId }, authenticated.user.id);
        return json(res, 200, { ...result, target: recorded });
      } catch (error) {
        // The target is known to exist at this point (checked above), so recording the
        // failure against it cannot itself throw "not found" the way it could if `id` had
        // never been validated.
        const reason = error instanceof RemoteTargetFetchError ? error.reason : error.message;
        remoteTargetRegistry.recordFetch(id, { ok: false, error: reason }, authenticated.user.id);
        if (error instanceof RemoteTargetFetchError) return json(res, 502, { error: error.kind, reason: error.reason });
        if (error.status) return json(res, error.status, { error: error.message });
        throw error;
      }
    }
    const remoteTargetDeleteMatch = url.pathname.match(/^\/api\/v1\/debug-evolution\/remote-targets\/([^/]+)$/);
    if (remoteTargetDeleteMatch && req.method === 'DELETE') {
      const authenticated = requireOwner(req, res, 'audit.read');
      if (!authenticated || !requireCsrf(req, res, authenticated)) return;
      try {
        return json(res, 200, remoteTargetRegistry.remove(decodeURIComponent(remoteTargetDeleteMatch[1]), authenticated.user.id));
      } catch (error) {
        if (error.status) return json(res, error.status, { error: error.message });
        throw error;
      }
    }

    // --- Debug Evolution API targets (D-0292, Owner s305 point C) -----------------------
    // The third way to attach a target, and the only one whose subject is not a source tree
    // but a service that is running. Registration and the credential stay here, in the same
    // vault as everything else; the probe runs in the module, because `remote-api.pyz` is in
    // its image and this container has no Python interpreter to run it with (measured, not
    // assumed). `api-target-probe.mjs`'s header states plainly what that inverts and what is
    // therefore NOT claimed about where the credential goes.
    if (req.method === 'GET' && url.pathname === '/api/v1/debug-evolution/api-targets') {
      const authenticated = requireSession(req, res, 'workspace.read'); if (!authenticated) return;
      return json(res, 200, { targets: apiTargetRegistry.list() });
    }
    if (req.method === 'POST' && url.pathname === '/api/v1/debug-evolution/api-targets') {
      const authenticated = requireOwner(req, res, 'audit.read');
      if (!authenticated || !requireCsrf(req, res, authenticated)) return;
      const payload = await body(req);
      try {
        return json(res, 201, apiTargetRegistry.create({
          name: payload?.name, baseUrl: payload?.baseUrl, protectedPath: payload?.protectedPath,
          allowPrivateTargets: payload?.allowPrivateTargets, allowMutation: payload?.allowMutation,
          allowIntrusive: payload?.allowIntrusive, allowBillable: payload?.allowBillable,
        }, authenticated.user.id));
      } catch (error) {
        if (error.status) return json(res, error.status, { error: error.message });
        throw error;
      }
    }
    // Editing rather than delete-and-recreate: the registry's own `update()` explains why —
    // a grant's history is the part worth keeping, and deleting destroys it.
    const apiTargetUpdateMatch = url.pathname.match(/^\/api\/v1\/debug-evolution\/api-targets\/([^/]+)$/);
    if (apiTargetUpdateMatch && req.method === 'PATCH') {
      const authenticated = requireOwner(req, res, 'audit.read');
      if (!authenticated || !requireCsrf(req, res, authenticated)) return;
      const payload = await body(req);
      try {
        return json(res, 200, apiTargetRegistry.update(decodeURIComponent(apiTargetUpdateMatch[1]), payload ?? {}, authenticated.user.id));
      } catch (error) {
        if (error.status) return json(res, error.status, { error: error.message });
        throw error;
      }
    }
    const apiTargetCredentialMatch = url.pathname.match(/^\/api\/v1\/debug-evolution\/api-targets\/([^/]+)\/credential$/);
    if (apiTargetCredentialMatch && (req.method === 'POST' || req.method === 'DELETE')) {
      const authenticated = requireOwner(req, res, 'audit.read');
      if (!authenticated || !requireCsrf(req, res, authenticated)) return;
      const id = decodeURIComponent(apiTargetCredentialMatch[1]);
      try {
        if (req.method === 'DELETE') return json(res, 200, apiTargetRegistry.clearCredential(id, authenticated.user.id));
        const payload = await body(req);
        return json(res, 200, apiTargetRegistry.setCredential(id, {
          scheme: payload?.scheme, headerName: payload?.headerName, secret: payload?.secret,
        }, authenticated.user.id));
      } catch (error) {
        if (error.status) return json(res, error.status, { error: error.message });
        throw error;
      }
    }
    const apiTargetProbeMatch = url.pathname.match(/^\/api\/v1\/debug-evolution\/api-targets\/([^/]+)\/probe$/);
    if (apiTargetProbeMatch && req.method === 'POST') {
      const authenticated = requireOwner(req, res, 'audit.read');
      if (!authenticated || !requireCsrf(req, res, authenticated)) return;
      if (!isModuleActive(sectorModulesRoot, DEBUG_EVOLUTION_MODULE_ID)) {
        return json(res, 409, { error:'The Debug Evolution module is not active on this installation.' });
      }
      const id = decodeURIComponent(apiTargetProbeMatch[1]);
      let target;
      try {
        target = apiTargetRegistry.get(id);
      } catch (error) {
        return json(res, error.status ?? 500, { error: error.message });
      }
      try {
        const result = await probeApiTarget(target, apiTargetRegistry.resolveCredentialHeaders(id));
        const recorded = apiTargetRegistry.recordProbe(id, {
          ok: true, projectId: result.projectId, findingCount: result.findingCount,
        }, authenticated.user.id);
        return json(res, 200, { ...result, target: recorded });
      } catch (error) {
        // Same ordering as the SSH fetch above: the target is already known to exist, so
        // recording the failure cannot itself throw "not found".
        apiTargetRegistry.recordProbe(id, { ok: false, error: error.message }, authenticated.user.id);
        if (error.status) return json(res, error.status, { error: error.message });
        throw error;
      }
    }
    const apiTargetDeleteMatch = url.pathname.match(/^\/api\/v1\/debug-evolution\/api-targets\/([^/]+)$/);
    if (apiTargetDeleteMatch && req.method === 'DELETE') {
      const authenticated = requireOwner(req, res, 'audit.read');
      if (!authenticated || !requireCsrf(req, res, authenticated)) return;
      try {
        return json(res, 200, apiTargetRegistry.remove(decodeURIComponent(apiTargetDeleteMatch[1]), authenticated.user.id));
      } catch (error) {
        if (error.status) return json(res, error.status, { error: error.message });
        throw error;
      }
    }

    // --- trusted publisher registry (D-0275) -------------------------------------------
    // docs/capabilities/PUBLISHER_REVOCATION.md: "Publisher and package revocation require
    // an Owner session with recent strong reauthentication." Registering a key gets the
    // same requirement here — it is what makes a publisher trusted in the first place,
    // the same weight D-0272 gives to pinning an update channel key.
    if (req.method === 'GET' && url.pathname === '/api/v1/publishers') {
      const authenticated = requireOwner(req, res, 'audit.read'); if (!authenticated) return;
      return json(res, 200, publisherRegistry.status());
    }
    if (req.method === 'POST' && url.pathname === '/api/v1/publishers/register') {
      const authenticated = requireOwner(req, res, 'audit.read');
      if (!authenticated || !requireCsrf(req, res, authenticated)) return;
      if (authenticated.session.elevatedUntil < Date.now()) return json(res, 403, { error:'Recent strong reauthentication is required to register a publisher key.' });
      const payload = await body(req);
      const nowUnix = Math.floor(Date.now() / 1000);
      try {
        const result = publisherRegistry.registerKey({
          publisherId: payload?.publisherId, trustLevel: payload?.trustLevel, publicKeyPem: payload?.publicKeyPem,
          actorId: authenticated.user.id, nowUnix,
        });
        return json(res, 201, result);
      } catch (error) {
        if (error instanceof PublisherRegistryError) return json(res, 422, { error:'publisher_registry_refused', kind:error.kind, reason:error.message });
        throw error;
      }
    }
    if (req.method === 'POST' && url.pathname === '/api/v1/publishers/revoke') {
      const authenticated = requireOwner(req, res, 'audit.read');
      if (!authenticated || !requireCsrf(req, res, authenticated)) return;
      if (authenticated.session.elevatedUntil < Date.now()) return json(res, 403, { error:'Recent strong reauthentication is required to revoke a publisher key.' });
      const payload = await body(req);
      const nowUnix = Math.floor(Date.now() / 1000);
      try {
        const result = publisherRegistry.revoke({
          publisherId: payload?.publisherId, fingerprint: payload?.fingerprint ?? null,
          actorId: authenticated.user.id, nowUnix, reason: payload?.reason ?? null,
        });
        return json(res, 200, result);
      } catch (error) {
        if (error instanceof PublisherRegistryError) return json(res, error.kind === 'UNKNOWN_PUBLISHER' ? 404 : 422, { error:'publisher_registry_refused', kind:error.kind, reason:error.message });
        throw error;
      }
    }
    if (req.method === 'POST' && url.pathname === '/api/v1/publishers/set-trust-level') {
      const authenticated = requireOwner(req, res, 'audit.read');
      if (!authenticated || !requireCsrf(req, res, authenticated)) return;
      if (authenticated.session.elevatedUntil < Date.now()) return json(res, 403, { error:'Recent strong reauthentication is required to change a publisher trust level.' });
      const payload = await body(req);
      const nowUnix = Math.floor(Date.now() / 1000);
      try {
        const result = publisherRegistry.setTrustLevel({
          publisherId: payload?.publisherId, trustLevel: payload?.trustLevel, actorId: authenticated.user.id, nowUnix,
        });
        return json(res, 200, result);
      } catch (error) {
        if (error instanceof PublisherRegistryError) return json(res, error.kind === 'UNKNOWN_PUBLISHER' ? 404 : 422, { error:'publisher_registry_refused', kind:error.kind, reason:error.message });
        throw error;
      }
    }

    // --- compliance packs · phase 7 step 28 ("il mondo esterno", 09_PIANO.md §2) --------
    // Read-only: validates schema + the "dated" temporal window, lists installed packs,
    // and (when NOESAR_COMPLIANCE_PACK_PUBKEY names a PEM file) checks the Ed25519
    // signature. No signing here -- a private key never reaches an HTTP handler; signing
    // is a publishing-time operation, same posture as the Python reference's
    // build-signed-package.py for capability packages. No Rust twin, same reason as
    // repo-map/sector-modules: this proposes and verifies, it does not decide anything yet.
    if (req.method === 'GET' && url.pathname === '/api/v1/compliance-packs') {
      const authenticated = requireSession(req, res); if (!authenticated) return;
      return json(res, 200, compliancePacksStatus(repoRoot, compliancePacksRoot));
    }
    if (req.method === 'GET' && url.pathname === '/api/v1/compliance-packs/list') {
      const authenticated = requireSession(req, res); if (!authenticated) return;
      if (!auth.hasPermission(authenticated.user, 'workspace.read')) {
        return json(res, 403, { error:'forbidden', requiredPermission:'workspace.read' });
      }
      try {
        const pubkeyPath = process.env.NOESAR_COMPLIANCE_PACK_PUBKEY;
        const publicKeyPem = pubkeyPath && existsSync(pubkeyPath) ? readFileSync(pubkeyPath, 'utf8') : undefined;
        const scan = loadCompliancePacks(repoRoot, compliancePacksRoot, { publicKeyPem });
        ledger.append({ actor:authenticated.user.id, action:'compliance_packs.scanned', result:'success', details:{ scanned:scan.scanned, valid:scan.valid.length, invalid:scan.invalid.length, truncated:scan.truncated, signatureChecked:Boolean(publicKeyPem) } });
        return json(res, 200, scan);
      } catch (error) {
        if (error instanceof CompliancePackError) return json(res, 422, { error:'compliance_pack_refused', kind:error.kind, reason:error.reason });
        throw error;
      }
    }
    if (req.method === 'POST' && url.pathname === '/api/v1/compliance-packs/validate') {
      const authenticated = requireSession(req, res); if (!authenticated) return;
      if (!auth.hasPermission(authenticated.user, 'workspace.read')) {
        return json(res, 403, { error:'forbidden', requiredPermission:'workspace.read' });
      }
      const payload = await body(req);
      try {
        const schema = loadComplianceSchema(repoRoot);
        const schemaResult = validateCompliancePackDocument(payload ?? {}, schema);
        const dateResult = schemaResult.valid ? checkPackDates(payload) : { valid:true, errors:[] };
        const result = { valid: schemaResult.valid && dateResult.valid, errors:[...schemaResult.errors, ...dateResult.errors] };
        ledger.append({ actor:authenticated.user.id, action:'compliance_packs.validated', result: result.valid ? 'success' : 'refused', details:{ valid:result.valid, errorCount:result.errors.length } });
        return json(res, 200, result);
      } catch (error) {
        if (error instanceof CompliancePackError) return json(res, 422, { error:'compliance_pack_refused', kind:error.kind, reason:error.reason });
        throw error;
      }
    }

    // --- technology radar · phase 7 step 29 ("il mondo esterno", 09_PIANO.md §2) -------
    // Read-only: the fifteen-entry seed (real, already-adopted tracking, not a framework
    // placeholder) plus schema/signature validation for live entries added later. Never
    // executes anything an entry describes -- PROJECT_GOVERNANCE/04_AI_PLATFORM/
    // 48_TECHNOLOGY_RADAR.md's "never automatically executes third-party code" is upheld
    // by omission. No CSRF (none of the four mutate product state). No Rust twin, same
    // reason as repo-map/sector-modules/compliance-packs.
    if (req.method === 'GET' && url.pathname === '/api/v1/technology-radar') {
      const authenticated = requireSession(req, res); if (!authenticated) return;
      return json(res, 200, technologyRadarStatus(repoRoot, technologyRadarRoot));
    }
    if (req.method === 'GET' && url.pathname === '/api/v1/technology-radar/seed') {
      const authenticated = requireSession(req, res); if (!authenticated) return;
      try {
        return json(res, 200, loadRadarSeed(repoRoot));
      } catch (error) {
        if (error instanceof TechnologyRadarError) return json(res, 422, { error:'technology_radar_refused', kind:error.kind, reason:error.reason });
        throw error;
      }
    }
    if (req.method === 'GET' && url.pathname === '/api/v1/technology-radar/list') {
      const authenticated = requireSession(req, res); if (!authenticated) return;
      if (!auth.hasPermission(authenticated.user, 'workspace.read')) {
        return json(res, 403, { error:'forbidden', requiredPermission:'workspace.read' });
      }
      try {
        const scan = loadTechnologyRadar(repoRoot, technologyRadarRoot);
        ledger.append({ actor:authenticated.user.id, action:'technology_radar.scanned', result:'success', details:{ scanned:scan.scanned, valid:scan.valid.length, invalid:scan.invalid.length, truncated:scan.truncated } });
        return json(res, 200, scan);
      } catch (error) {
        if (error instanceof TechnologyRadarError) return json(res, 422, { error:'technology_radar_refused', kind:error.kind, reason:error.reason });
        throw error;
      }
    }
    if (req.method === 'POST' && url.pathname === '/api/v1/technology-radar/validate') {
      const authenticated = requireSession(req, res); if (!authenticated) return;
      if (!auth.hasPermission(authenticated.user, 'workspace.read')) {
        return json(res, 403, { error:'forbidden', requiredPermission:'workspace.read' });
      }
      const payload = await body(req);
      try {
        const schema = loadRadarSchema(repoRoot);
        const result = validateRadarEntry(payload ?? {}, schema);
        ledger.append({ actor:authenticated.user.id, action:'technology_radar.validated', result: result.valid ? 'success' : 'refused', details:{ valid:result.valid, errorCount:result.errors.length } });
        return json(res, 200, result);
      } catch (error) {
        if (error instanceof TechnologyRadarError) return json(res, 422, { error:'technology_radar_refused', kind:error.kind, reason:error.reason });
        throw error;
      }
    }
    if (req.method === 'POST' && url.pathname === '/api/v1/technology-radar/transition-check') {
      const authenticated = requireSession(req, res); if (!authenticated) return;
      if (!auth.hasPermission(authenticated.user, 'workspace.read')) {
        return json(res, 403, { error:'forbidden', requiredPermission:'workspace.read' });
      }
      const payload = await body(req);
      const result = checkRingTransition(payload?.from, payload?.to);
      return json(res, 200, result);
    }

    // --- OIDC · phase 7 step 30, "OIDC, SAML, SCIM" first third -------------------------
    // Verifies a supplied ID token or discovery document. No redirect flow, no token
    // endpoint, no session issued from a verified token — see the module comment in
    // oidc.mjs for why. No CSRF (no product state mutated). No Rust twin.
    if (req.method === 'GET' && url.pathname === '/api/v1/oidc') {
      const authenticated = requireSession(req, res); if (!authenticated) return;
      return json(res, 200, oidcStatus());
    }
    if (req.method === 'POST' && url.pathname === '/api/v1/oidc/verify-id-token') {
      const authenticated = requireSession(req, res); if (!authenticated) return;
      if (!auth.hasPermission(authenticated.user, 'workspace.read')) {
        return json(res, 403, { error:'forbidden', requiredPermission:'workspace.read' });
      }
      const payload = await body(req);
      try {
        const claims = verifyIdToken(payload?.idToken, payload?.jwks, { issuer:payload?.issuer, audience:payload?.audience });
        ledger.append({ actor:authenticated.user.id, action:'oidc.id_token_verified', result:'success', details:{ iss:claims.iss, sub:claims.sub } });
        return json(res, 200, { valid:true, claims });
      } catch (error) {
        if (error instanceof OidcError) {
          ledger.append({ actor:authenticated.user.id, action:'oidc.id_token_verified', result:'refused', details:{ kind:error.kind } });
          return json(res, 200, { valid:false, kind:error.kind, reason:error.reason });
        }
        throw error;
      }
    }
    if (req.method === 'POST' && url.pathname === '/api/v1/oidc/validate-discovery') {
      const authenticated = requireSession(req, res); if (!authenticated) return;
      if (!auth.hasPermission(authenticated.user, 'workspace.read')) {
        return json(res, 403, { error:'forbidden', requiredPermission:'workspace.read' });
      }
      const payload = await body(req);
      return json(res, 200, validateDiscoveryDocument(payload));
    }

    // --- SCIM management · phase 7 step 30, "OIDC, SAML, SCIM" third third --------------
    // Session-authenticated (owner/admin only): mint/list/revoke the bearer tokens the
    // actual /scim/v2/* protocol surface (below) accepts. Mutating routes carry CSRF —
    // this is the ordinary cookie-session part of the feature, unlike /scim/v2/* itself.
    if (req.method === 'GET' && url.pathname === '/api/v1/scim') {
      const authenticated = requireSession(req, res); if (!authenticated) return;
      return json(res, 200, scimStatus());
    }
    if (req.method === 'POST' && url.pathname === '/api/v1/scim/tokens') {
      // Gated on `user.manage` — the same permission /api/v1/admin/users already requires
      // for provisioning, not a second hand-written role list that could drift from it.
      const authenticated = requireSession(req, res, 'user.manage'); if (!authenticated) return;
      if (!requireCsrf(req, res, authenticated)) return;
      const payload = await body(req);
      const minted = mintScimToken(scimTokenStore, { sponsorActorId:authenticated.user.id, name:payload?.name, ttlDays:payload?.ttlDays ?? null });
      ledger.append({ actor:authenticated.user.id, action:'scim.token_minted', result:'success', details:{ tokenId:minted.tokenId, name:payload?.name ?? null } });
      return json(res, 201, minted);
    }
    if (req.method === 'GET' && url.pathname === '/api/v1/scim/tokens') {
      const authenticated = requireSession(req, res, 'user.manage'); if (!authenticated) return;
      return json(res, 200, { tokens: listScimTokens(scimTokenStore, { sponsorActorId:authenticated.user.id }) });
    }
    let scimTokenRevokeMatch = url.pathname.match(/^\/api\/v1\/scim\/tokens\/([^/]+)\/revoke$/);
    if (scimTokenRevokeMatch && req.method === 'POST') {
      const authenticated = requireSession(req, res); if (!authenticated) return;
      if (!requireCsrf(req, res, authenticated)) return;
      try {
        const revoked = revokeScimToken(scimTokenStore, { actorId:authenticated.user.id, tokenId:scimTokenRevokeMatch[1] });
        ledger.append({ actor:authenticated.user.id, action:'scim.token_revoked', result:'success', details:{ tokenId:scimTokenRevokeMatch[1] } });
        return json(res, 200, revoked);
      } catch (error) {
        if (error instanceof ScimError) return json(res, error.status, { error:error.kind, reason:error.reason });
        throw error;
      }
    }

    // --- SCIM protocol · RFC 7643/7644 --------------------------------------------------
    // Bearer-authenticated (requireScimAuth), never a cookie session — the sponsor's
    // actorId is what every UserDirectory call below uses, so UserDirectory's own
    // GRANTABLE/#requireActor authorization decides what a given integration may do,
    // exactly as it would for the sponsor acting directly. WIRED: unlike steps 27-29,
    // these calls really create/disable/reinstate/deprovision an account.
    if (req.method === 'GET' && url.pathname === '/scim/v2/ServiceProviderConfig') {
      if (!requireScimAuth(req, res)) return;
      return json(res, 200, scimServiceProviderConfig(`${req.headers['x-forwarded-proto'] ?? 'http'}://${req.headers.host}`), { 'content-type':'application/scim+json; charset=utf-8' });
    }
    if (req.method === 'GET' && url.pathname === '/scim/v2/Users') {
      const scim = requireScimAuth(req, res); if (!scim) return;
      const baseUrl = `${req.headers['x-forwarded-proto'] ?? 'http'}://${req.headers.host}`;
      const list = scimListResponse(userDirectory.list(), {
        startIndex: url.searchParams.get('startIndex'), count: url.searchParams.get('count'),
      }, baseUrl);
      return json(res, 200, list, { 'content-type':'application/scim+json; charset=utf-8' });
    }
    if (req.method === 'POST' && url.pathname === '/scim/v2/Users') {
      const scim = requireScimAuth(req, res); if (!scim) return;
      const payload = await body(req);
      try {
        const created = userDirectory.createServiceAccount({
          actorId: scim.sponsorActorId, username: payload?.userName, displayName: payload?.displayName ?? payload?.userName,
        });
        const baseUrl = `${req.headers['x-forwarded-proto'] ?? 'http'}://${req.headers.host}`;
        return json(res, 201, toScimUser(created.user, baseUrl), { 'content-type':'application/scim+json; charset=utf-8' });
      } catch (error) {
        return json(res, error.status ?? 400, scimError(error.status ?? 400, error.message), { 'content-type':'application/scim+json; charset=utf-8' });
      }
    }
    let scimUserMatch = url.pathname.match(/^\/scim\/v2\/Users\/([^/]+)$/);
    if (scimUserMatch && req.method === 'GET') {
      const scim = requireScimAuth(req, res); if (!scim) return;
      const account = userDirectory.find(scimUserMatch[1]);
      if (!account) return json(res, 404, scimError(404, 'no such user'), { 'content-type':'application/scim+json; charset=utf-8' });
      const baseUrl = `${req.headers['x-forwarded-proto'] ?? 'http'}://${req.headers.host}`;
      return json(res, 200, toScimUser(account, baseUrl), { 'content-type':'application/scim+json; charset=utf-8' });
    }
    if (scimUserMatch && req.method === 'PATCH') {
      const scim = requireScimAuth(req, res); if (!scim) return;
      const payload = await body(req);
      try {
        const { active } = applyScimPatch(payload);
        if (active === false) userDirectory.disableUser({ actorId:scim.sponsorActorId, userId:scimUserMatch[1], reason:'SCIM PATCH active=false' });
        if (active === true) userDirectory.reinstateUser({ actorId:scim.sponsorActorId, userId:scimUserMatch[1] });
        const account = userDirectory.find(scimUserMatch[1]);
        if (!account) return json(res, 404, scimError(404, 'no such user'), { 'content-type':'application/scim+json; charset=utf-8' });
        const baseUrl = `${req.headers['x-forwarded-proto'] ?? 'http'}://${req.headers.host}`;
        return json(res, 200, toScimUser(account, baseUrl), { 'content-type':'application/scim+json; charset=utf-8' });
      } catch (error) {
        if (error instanceof ScimError) return json(res, error.status, scimError(error.status, error.reason), { 'content-type':'application/scim+json; charset=utf-8' });
        return json(res, error.status ?? 400, scimError(error.status ?? 400, error.message), { 'content-type':'application/scim+json; charset=utf-8' });
      }
    }
    if (scimUserMatch && req.method === 'DELETE') {
      const scim = requireScimAuth(req, res); if (!scim) return;
      try {
        userDirectory.revokeUser({ actorId:scim.sponsorActorId, userId:scimUserMatch[1], reason:'SCIM deprovisioning' });
        // 200 with an empty object, not 204: json() always writes a body, and a 204 that
        // carries one violates RFC 7231 §6.3.5 rather than merely being unusual.
        return json(res, 200, {});
      } catch (error) {
        return json(res, error.status ?? 400, scimError(error.status ?? 400, error.message), { 'content-type':'application/scim+json; charset=utf-8' });
      }
    }

    // --- tool catalog · CodeN Evolution construction order step 10 ("il catalogo strumenti
    // a carico zero", 15_CODEN_EVOLUTION_DA_ZERO.md §3.V) --------------------------------
    // Searchable, never a load: /search returns metadata, never a tool's payload. Install
    // registers a provenance-verified entry as active for this process (in memory, same
    // posture as capability.mjs's TokenMinter) — it does not fetch or run anything.
    // ---- `/skills`: the zero-load skill catalogue ------------------------------------
    // Searchable, never a load. `/search` returns metadata and cannot return a skill's
    // instructions — not because this route strips them, but because searchCatalog() builds
    // its result from a field list that has no such member.
    if (req.method === 'GET' && url.pathname === '/api/v1/skill-catalog') {
      const authenticated = requireSession(req, res); if (!authenticated) return;
      return json(res, 200, skillCatalogStatus(adoptedSkillRegistry));
    }
    if (req.method === 'GET' && url.pathname === '/api/v1/skill-catalog/search') {
      const authenticated = requireSession(req, res); if (!authenticated) return;
      if (!auth.hasPermission(authenticated.user, 'workspace.read')) {
        return json(res, 403, { error:'forbidden', requiredPermission:'workspace.read' });
      }
      try {
        return json(res, 200, searchSkillCatalogEntries(repoRoot, skillCatalogRoot, {
          name: url.searchParams.get('name') ?? undefined,
          operation: url.searchParams.get('operation') ?? undefined,
        }));
      } catch (error) {
        if (error instanceof SkillCatalogError) return json(res, 422, { error:'skill_catalog_refused', kind:error.kind, reason:error.reason });
        throw error;
      }
    }
    if (req.method === 'GET' && url.pathname === '/api/v1/tool-catalog') {
      const authenticated = requireSession(req, res); if (!authenticated) return;
      return json(res, 200, toolCatalogStatus(activeToolRegistry));
    }
    if (req.method === 'GET' && url.pathname === '/api/v1/tool-catalog/search') {
      const authenticated = requireSession(req, res); if (!authenticated) return;
      if (!auth.hasPermission(authenticated.user, 'workspace.read')) {
        return json(res, 403, { error:'forbidden', requiredPermission:'workspace.read' });
      }
      try {
        const result = searchCatalog(repoRoot, toolCatalogRoot, {
          name: url.searchParams.get('name') ?? undefined,
          operation: url.searchParams.get('operation') ?? undefined,
        });
        return json(res, 200, result);
      } catch (error) {
        if (error instanceof ToolCatalogError) return json(res, 422, { error:'tool_catalog_refused', kind:error.kind, reason:error.reason });
        throw error;
      }
    }
    if (req.method === 'POST' && url.pathname === '/api/v1/tool-catalog/validate') {
      const authenticated = requireSession(req, res); if (!authenticated) return;
      if (!auth.hasPermission(authenticated.user, 'workspace.read')) {
        return json(res, 403, { error:'forbidden', requiredPermission:'workspace.read' });
      }
      const payload = await body(req);
      try {
        const schema = loadToolCatalogSchema(repoRoot);
        return json(res, 200, validateToolEntry(payload ?? {}, schema));
      } catch (error) {
        if (error instanceof ToolCatalogError) return json(res, 422, { error:'tool_catalog_refused', kind:error.kind, reason:error.reason });
        throw error;
      }
    }
    if (req.method === 'POST' && url.pathname === '/api/v1/tool-catalog/install') {
      const authenticated = requireSession(req, res); if (!authenticated) return;
      if (!auth.hasPermission(authenticated.user, 'workspace.write')) {
        return json(res, 403, { error:'forbidden', requiredPermission:'workspace.write' });
      }
      if (!requireCsrf(req, res, authenticated)) return;
      const payload = await body(req);
      try {
        const installed = activeToolRegistry.install(payload?.tool, { sessionId: authenticated.session?.id ?? authenticated.user.id, permanent: Boolean(payload?.permanent) });
        ledger.append({ actor:authenticated.user.id, action:'tool_catalog.installed', result:'success', details:{ toolId: payload?.tool?.id ?? null, permanent: Boolean(payload?.permanent) } });
        return json(res, 201, installed);
      } catch (error) {
        if (error instanceof ToolCatalogError) return json(res, 422, { error:'tool_catalog_refused', kind:error.kind, reason:error.reason });
        throw error;
      }
    }
    let toolCatalogUninstallMatch = url.pathname.match(/^\/api\/v1\/tool-catalog\/([^/]+)\/uninstall$/);
    if (toolCatalogUninstallMatch && req.method === 'POST') {
      const authenticated = requireSession(req, res); if (!authenticated) return;
      if (!auth.hasPermission(authenticated.user, 'workspace.write')) {
        return json(res, 403, { error:'forbidden', requiredPermission:'workspace.write' });
      }
      if (!requireCsrf(req, res, authenticated)) return;
      const outcome = activeToolRegistry.uninstall(toolCatalogUninstallMatch[1]);
      ledger.append({ actor:authenticated.user.id, action:'tool_catalog.uninstalled', result:'success', details:{ toolId: toolCatalogUninstallMatch[1] } });
      return json(res, 200, outcome);
    }

    // --- workspace actions · D-0190, the first surface that spends a token for real --------
    // The trivial risk path only: one step, WRITE only, files supplied by the caller (the
    // reference reasoning provider has no model — see the module comment in
    // workspace-actions.mjs). A plan is proposed, a human approves or rejects it, and an
    // approval either promotes cleanly to the real workspace or changes nothing at all.
    if (req.method === 'GET' && url.pathname === '/api/v1/workspace-actions') {
      const authenticated = requireSession(req, res); if (!authenticated) return;
      return json(res, 200, workspaceActionsStatus());
    }
    // Point 4b: the runs one chat owns. It sits ABOVE the `/:id` matcher below on purpose —
    // that pattern is `([^/]+)` and would happily read the word `runs` as a run id and answer
    // 404 for a route that exists.
    if (req.method === 'GET' && url.pathname === '/api/v1/workspace-actions/runs') {
      const authenticated = requireSession(req, res); if (!authenticated) return;
      // Reading which work belongs where is reading, not deciding — `workspace.read`, the same
      // level as GET :id, which discloses strictly more than these summaries do.
      if (!auth.hasPermission(authenticated.user, 'workspace.read')) {
        return json(res, 403, { error:'forbidden', requiredPermission:'workspace.read' });
      }
      const conversationId = url.searchParams.get('conversationId');
      const scope = url.searchParams.get('scope') ?? (conversationId ? 'conversation' : 'all');
      try {
        return json(res, 200, workspaceActions.runsFor({ scope, conversationId }));
      } catch (error) {
        if (error instanceof WorkspaceActionError) return json(res, 422, { error:'workspace_action_refused', kind:error.kind, reason:error.reason });
        throw error;
      }
    }
    if (req.method === 'POST' && url.pathname === '/api/v1/workspace-actions/plan') {
      const authenticated = requireSession(req, res); if (!authenticated) return;
      if (!auth.hasPermission(authenticated.user, 'workspace.write')) {
        return json(res, 403, { error:'forbidden', requiredPermission:'workspace.write' });
      }
      if (!requireCsrf(req, res, authenticated)) return;
      const payload = await body(req);
      const nowUnix = Math.floor(Date.now() / 1000);
      // Point 4b, and the half of the Owner's decision that has to be enforced rather than
      // merely recorded: a run may name the chat that opened it, but ONLY a chat that exists.
      // The check happens here because this is where the context graph is — workspace-actions
      // holds the id opaquely — and it is fail-closed: an unknown conversation refuses the run
      // instead of storing a link that resolves to nothing and rendering as an empty panel.
      let conversationId = null;
      if (payload?.conversationId !== undefined && payload?.conversationId !== null) {
        if (typeof payload.conversationId !== 'string' || !payload.conversationId.trim()) {
          return json(res, 422, { error:'workspace_action_refused', kind:'INVALID_CONVERSATION', reason:'conversationId must be a non-empty string when supplied' });
        }
        try {
          contextGraph.getConversation(payload.conversationId);
        } catch {
          return json(res, 422, { error:'workspace_action_refused', kind:'UNKNOWN_CONVERSATION', reason:`no conversation \`${payload.conversationId}\`` });
        }
        conversationId = payload.conversationId;
      }
      try {
        const planned = await workspaceActions.plan({
          request: payload?.request, files: payload?.files, projectRules: payload?.projectRules ?? [],
          constraints: payload?.constraints ?? [], mode: payload?.mode ?? 'safe', policy: payload?.policy ?? 'restrictive',
          actor: authenticated.user.id, nowUnix, claims: payload?.claims ?? [], conversationId,
        });
        return json(res, 201, planned);
      } catch (error) {
        if (error instanceof WorkspaceActionError) return json(res, 422, { error:'workspace_action_refused', kind:error.kind, reason:error.reason });
        // A selected provider that could not be reached is not this run being refused. 422
        // would tell the caller their plan was rejected, which is a different and false fact.
        if (error instanceof ReasoningUnavailable) {
          return json(res, 503, {
            error:'reasoning_unavailable', reason:error.reason,
            surface:error.surface, endpoint:error.endpoint,
          });
        }
        throw error;
      }
    }
    let workspaceActionMatch = url.pathname.match(/^\/api\/v1\/workspace-actions\/([^/]+)$/);
    if (workspaceActionMatch && req.method === 'GET') {
      const authenticated = requireSession(req, res); if (!authenticated) return;
      const run = workspaceActions.get(workspaceActionMatch[1]);
      if (!run) return json(res, 404, { error:'not_found' });
      return json(res, 200, run);
    }
    // SESS-001: the ten-field Session Proof for one run. Same trust level as GET :id above —
    // this is a derived view of the same object, not a wider disclosure.
    workspaceActionMatch = url.pathname.match(/^\/api\/v1\/workspace-actions\/([^/]+)\/session-proof$/);
    if (workspaceActionMatch && req.method === 'GET') {
      const authenticated = requireSession(req, res); if (!authenticated) return;
      const proof = workspaceActions.sessionProof(workspaceActionMatch[1]);
      if (!proof) return json(res, 404, { error:'not_found' });
      return json(res, 200, proof);
    }
    // "What would this do?", asked before anyone approves it. No token is minted, nothing is
    // executed, and the shadow it reads is discarded before the response is written.
    // `workspace.read` rather than `workspace.write`: asking is not deciding. It is still a
    // POST — it allocates a whole-workspace shadow — so it carries the CSRF gate every other
    // POST here carries. D-0193 was exactly a POST on this surface that did not.
    workspaceActionMatch = url.pathname.match(/^\/api\/v1\/workspace-actions\/([^/]+)\/simulate$/);
    if (workspaceActionMatch && req.method === 'POST') {
      const authenticated = requireSession(req, res); if (!authenticated) return;
      if (!auth.hasPermission(authenticated.user, 'workspace.read')) {
        return json(res, 403, { error:'forbidden', requiredPermission:'workspace.read' });
      }
      if (!requireCsrf(req, res, authenticated)) return;
      const nowUnix = Math.floor(Date.now() / 1000);
      try {
        const outcome = await workspaceActions.simulate({
          runId: workspaceActionMatch[1], actor: authenticated.user.id, nowUnix,
        });
        return json(res, 200, outcome);
      } catch (error) {
        if (error instanceof WorkspaceActionError) return json(res, 422, { error:'workspace_action_refused', kind:error.kind, reason:error.reason });
        if (error instanceof ReasoningUnavailable) {
          return json(res, 503, {
            error:'reasoning_unavailable', reason:error.reason,
            surface:error.surface, endpoint:error.endpoint,
          });
        }
        throw error;
      }
    }
    // SESS-002: does replaying this run reproduce the same decisions? Same trust level as
    // simulate — `workspace.read`, CSRF gated because it is a POST — because replay mints no
    // token, executes nothing, and changes no workspace file; it only asks a question.
    workspaceActionMatch = url.pathname.match(/^\/api\/v1\/workspace-actions\/([^/]+)\/replay$/);
    if (workspaceActionMatch && req.method === 'POST') {
      const authenticated = requireSession(req, res); if (!authenticated) return;
      if (!auth.hasPermission(authenticated.user, 'workspace.read')) {
        return json(res, 403, { error:'forbidden', requiredPermission:'workspace.read' });
      }
      if (!requireCsrf(req, res, authenticated)) return;
      const nowUnix = Math.floor(Date.now() / 1000);
      try {
        const outcome = await workspaceActions.replay({
          runId: workspaceActionMatch[1], actor: authenticated.user.id, nowUnix,
        });
        return json(res, 200, outcome);
      } catch (error) {
        if (error instanceof WorkspaceActionError) return json(res, 422, { error:'workspace_action_refused', kind:error.kind, reason:error.reason });
        if (error instanceof ReasoningUnavailable) {
          return json(res, 503, {
            error:'reasoning_unavailable', reason:error.reason,
            surface:error.surface, endpoint:error.endpoint,
          });
        }
        throw error;
      }
    }
    // SESS-003: replay a historical, externally-supplied fixture against the CURRENT code's
    // own policy — not tied to any in-memory run, so a historical session may predate this
    // process entirely. Same trust level as replay/simulate: read-only, CSRF-gated POST.
    if (req.method === 'POST' && url.pathname === '/api/v1/session-proof/replay') {
      const authenticated = requireSession(req, res); if (!authenticated) return;
      if (!auth.hasPermission(authenticated.user, 'workspace.read')) {
        return json(res, 403, { error:'forbidden', requiredPermission:'workspace.read' });
      }
      if (!requireCsrf(req, res, authenticated)) return;
      const payload = await body(req);
      try {
        const outcome = await workspaceActions.replayHistoricalFixture({
          fixture: payload?.fixture, historicalOutcome: payload?.historicalOutcome,
        });
        return json(res, 200, outcome);
      } catch (error) {
        if (error instanceof WorkspaceActionError) return json(res, 422, { error:'workspace_action_refused', kind:error.kind, reason:error.reason });
        if (error instanceof ReasoningUnavailable) {
          return json(res, 503, {
            error:'reasoning_unavailable', reason:error.reason,
            surface:error.surface, endpoint:error.endpoint,
          });
        }
        throw error;
      }
    }
    workspaceActionMatch = url.pathname.match(/^\/api\/v1\/workspace-actions\/([^/]+)\/(approve|reject|restore)$/);
    if (workspaceActionMatch && req.method === 'POST') {
      const authenticated = requireSession(req, res); if (!authenticated) return;
      if (!auth.hasPermission(authenticated.user, 'workspace.write')) {
        return json(res, 403, { error:'forbidden', requiredPermission:'workspace.write' });
      }
      if (!requireCsrf(req, res, authenticated)) return;
      const [, runId, verb] = workspaceActionMatch;
      const payload = await body(req);
      const nowUnix = Math.floor(Date.now() / 1000);
      try {
        if (verb === 'approve') {
          const outcome = workspaceActions.approve({ runId, approverId: authenticated.user.id, nowUnix });
          compactRunAfterDecision(runId);
          return json(res, 200, outcome);
        }
        if (verb === 'reject') {
          const outcome = workspaceActions.reject({ runId, approverId: authenticated.user.id, reason: payload?.reason ?? null, nowUnix });
          compactRunAfterDecision(runId);
          return json(res, 200, outcome);
        }
        const outcome = workspaceActions.restore({ runId, actor: authenticated.user.id, nowUnix });
        return json(res, 200, outcome);
      } catch (error) {
        if (error instanceof WorkspaceActionError) return json(res, 422, { error:'workspace_action_refused', kind:error.kind, reason:error.reason });
        throw error;
      }
    }

    // --- the event ledger · phase 1 step 6 ---------------------------------------
    // Correlation and causation over a digest chain. Walking the causal chain of one
    // event is how the question of why something happened gets an answer instead of a
    // guess. Verification recomputes the whole chain rather than trusting the digest each
    // record carries: a record that vouches for itself vouches for nothing.
    if (req.method === 'GET' && url.pathname === '/api/v1/events') {
      const authenticated = requireSession(req, res); if (!authenticated) return;
      return json(res, 200, eventsStatus(engineEvents));
    }
    if (req.method === 'GET' && url.pathname === '/api/v1/events/verify') {
      const authenticated = requireSession(req, res); if (!authenticated) return;
      if (!auth.hasPermission(authenticated.user, 'audit.read')) {
        return json(res, 403, { error:'forbidden', requiredPermission:'audit.read' });
      }
      return json(res, 200, engineEvents.verify());
    }
    // The Logs panel of a piece of work: "why did this happen" for one run, not the whole
    // ledger. Read-only, same trust level as GET /api/v1/workspace-actions/:id (a session is
    // enough — this is the causal trail of a run the caller already has the object for, not
    // the aggregate audit view `audit.read` gates). An unknown correlationId returns an empty
    // list rather than 404: EventLedger.correlation() cannot distinguish "no such run" from
    // "this run recorded nothing yet", and inventing that distinction here would claim
    // knowledge this route does not have.
    const eventsCorrelationMatch = url.pathname.match(/^\/api\/v1\/events\/([^/]+)$/);
    if (eventsCorrelationMatch && req.method === 'GET') {
      const authenticated = requireSession(req, res); if (!authenticated) return;
      return json(res, 200, { correlationId: eventsCorrelationMatch[1], events: engineEvents.correlation(eventsCorrelationMatch[1]) });
    }

    // --- the session protocol's HTTP bridge — the WebUI's own Terminal tab -------------
    // The unix socket in session-protocol.mjs is the real terminal's transport; this is
    // the browser's, over the SAME dispatch and the SAME running instances (same live
    // session, per the bench's own copy: "not a second client with its own state"). One
    // route for every method rather than one per method, so the permission this route
    // enforces must be looked up by method name — the same gate the dedicated
    // workspace-actions/repo-map routes above already apply, not a weaker one a generic
    // bridge could accidentally offer.
    if (req.method === 'POST' && url.pathname === '/api/v1/tui/command') {
      const authenticated = requireSession(req, res); if (!authenticated) return;
      if (!requireCsrf(req, res, authenticated)) return;
      const payload = await body(req);
      const method = String(payload?.method ?? '');
      const requiredPermission = TUI_METHOD_PERMISSION[method];
      if (requiredPermission === undefined) return json(res, 400, { error:'unknown_method', method });
      if (requiredPermission && !auth.hasPermission(authenticated.user, requiredPermission)) {
        return json(res, 403, { error:'forbidden', requiredPermission });
      }
      try {
        const result = await sessionDispatch(method, payload?.params, authenticated.user.id,
          (permission) => auth.hasPermission(authenticated.user, permission));
        return json(res, 200, { ok:true, result });
      } catch (error) {
        if (error instanceof WorkspaceActionError || error instanceof RepoMapError || error instanceof ProtocolError) {
          return json(res, 422, { ok:false, error:{ kind:error.kind, reason:error.reason ?? error.message } });
        }
        throw error;
      }
    }

    // --- the executor · phase 1 step 5 ------------------------------------------
    // Reported, not offered as a surface: a run needs an approved plan, its tokens and a
    // shadow, and handing that whole chain to an HTTP caller would put the sandbox on the
    // far side of the wall it exists to be. The properties are stated here so the
    // installation can be asked what it enforces.
    if (req.method === 'GET' && url.pathname === '/api/v1/executor') {
      const authenticated = requireSession(req, res); if (!authenticated) return;
      return json(res, 200, executorStatus(executeSandboxConfig));
    }

    // --- shadow execution · phase 1 step 4 --------------------------------------
    // The contract already forces a plan to declare what must become true; this is the half
    // that makes the declaration worth having. The comparison is two-sided, and the second
    // side -- something happened that nobody declared -- is the dangerous one.
    if (req.method === 'GET' && url.pathname === '/api/v1/shadow') {
      const authenticated = requireSession(req, res); if (!authenticated) return;
      // F4-015: serves the snapshot taken at startup (or by the last reprobe). A GET must
      // not itself write to the filesystem, which probing does.
      return json(res, 200, shadowSnapshot);
    }
    if (req.method === 'POST' && url.pathname === '/api/v1/shadow/reprobe') {
      const authenticated = requireSession(req, res); if (!authenticated) return;
      // The only route left that probes the mount live — a write belongs behind a verb
      // that says so. Probed against the directory shadows are actually made in: reflink
      // support is a property of the mount, so asking anywhere else answers a different
      // question.
      shadowSnapshot = shadowStatus(join(workspace, 'shadows'));
      return json(res, 200, shadowSnapshot);
    }
    if (req.method === 'POST' && url.pathname === '/api/v1/shadow/compare') {
      const authenticated = requireSession(req, res); if (!authenticated) return;
      if (!auth.hasPermission(authenticated.user, 'workspace.read')) {
        return json(res, 403, { error:'forbidden', requiredPermission:'workspace.read' });
      }
      const payload = await body(req);
      try {
        const surprise = compareShadow(payload?.expectation ?? {}, payload?.observation ?? {});
        // A surprise is recorded whether or not it is clean: the run that turned out to be
        // clean is the one someone will want to point at later.
        ledger.append({ actor:authenticated.user.id, action:'shadow.compared',
          result:surprise.clean ? 'clean' : 'surprised', details:surprise });
        return json(res, 200, surprise);
      } catch (error) {
        if (error instanceof ShadowError) {
          return json(res, 422, { error:'shadow_refused', kind:error.kind, reason:error.reason });
        }
        throw error;
      }
    }

    // --- capability tokens · phase 1 step 3 ------------------------------------
    // A manifest is a request; the engine issues the tokens. Minting requires a plan an
    // approver signed, and the token can never name a path its step does not.
    if (req.method === 'GET' && url.pathname === '/api/v1/capability') {
      const authenticated = requireSession(req, res); if (!authenticated) return;
      return json(res, 200, capabilityStatus(capabilityMinter));
    }
    if (req.method === 'POST' && (url.pathname === '/api/v1/capability/mint'
      || url.pathname === '/api/v1/capability/spend')) {
      const authenticated = requireSession(req, res); if (!authenticated) return;
      // Holding a session is not holding the right to mint: the permission is the same one
      // that governs changing the workspace, because that is what a token licenses.
      if (!auth.hasPermission(authenticated.user, 'workspace.write')) {
        return json(res, 403, { error:'forbidden', requiredPermission:'workspace.write' });
      }
      if (!requireCsrf(req, res, authenticated)) return;
      const payload = await body(req);
      const nowUnix = Math.floor(Date.now() / 1000);
      try {
        if (url.pathname === '/api/v1/capability/mint') {
          const authorized = authorizePlan(payload?.plan, payload?.approval, nowUnix);
          const token = capabilityMinter.mint(authorized, payload?.request ?? {}, nowUnix);
          ledger.append({ actor:authenticated.user.id, action:'capability.minted', result:'issued', details:{ tokenId:token.id, stepId:token.stepId, planDigest:token.planDigest, paths:token.paths, operations:token.operations } });
          return json(res, 201, { token, planDigest:authorized.digest });
        }
        const spent = capabilityMinter.spend(payload?.token ?? {}, payload?.attempt ?? {}, nowUnix);
        ledger.append({ actor:authenticated.user.id, action:'capability.spent', result:'spent', details:{ tokenId:payload?.token?.id ?? null, attempt:payload?.attempt ?? null } });
        return json(res, 200, spent);
      } catch (error) {
        if (error instanceof CapabilityError) {
          // Every refusal carries its reason: "denied" with no reason is what makes an
          // audit trail useless. The refusal is recorded too — a refused attempt is the
          // one most worth being able to find later.
          ledger.append({ actor:authenticated.user.id, action:'capability.refused', result:'denied', details:{ kind:error.kind, reason:error.reason } });
          return json(res, error.kind === 'NOT_AUTHORIZED' ? 403 : 422,
            { error:'capability_refused', kind:error.kind, reason:error.reason });
        }
        throw error;
      }
    }

    // --- the initial screen · UI-060…UI-063 ----------------------------------
    // One request, assembled server-side, because each block depends on what this caller
    // may see and a browser cannot be trusted to withhold anything from itself. A block
    // the caller may not read comes back withheld WITH the permission it would need: a
    // silently empty panel and a forbidden one look identical, and only one of them means
    // "there is nothing here".
    if (req.method === 'GET' && url.pathname === '/api/v1/home') {
      const authenticated = requireSession(req, res); if (!authenticated) return;
      const may = (permission) => auth.hasPermission(authenticated.user, permission);
      const workspace = may('workspace.read');
      const hardware = may('hardware.read');
      // The detail behind service health is what the owner-only Health section shows.
      // Putting it on a page every role can reach would make the initial screen a way
      // around that gate, so the same two conditions are required here — and they are
      // now stated once, in mayReadHealthDetail, because /healthz needs the identical
      // test and two copies of a rule is how the two stop agreeing.
      const healthDetail = mayReadHealthDetail(authenticated.user);
      return json(res, 200, buildHomeOverview({
        health:buildHealth({
          product:PRODUCT, watchdog, auth, authority, dataPlane, logger, updateManager,
          timezone:timezoneService.serverDefault(), debug:debugMode.status(),
        }),
        mayReadHealthDetail:healthDetail,
        tools:workspace ? aiWorkspace.snapshot().tools : [],
        toolsPermitted:workspace,
        providers:workspace ? providerGateway.list() : [],
        providersPermitted:workspace,
        localModel:hardware ? localModels.status() : null,
        runtimePermitted:hardware,
        tasks:workspace ? aiWorkspace.listTasks({}) : [],
        tasksPermitted:workspace,
        lastSession:workspace
          ? (contextGraph.listSessions({ place:'active', page:1, pageSize:1 }).items[0] ?? null)
          : null,
        generatedAt:toUtcIso(),
      }));
    }
    if (req.method === 'GET' && url.pathname === '/api/v1/projects') {
      const authenticated = requireSession(req, res, 'workspace.read'); if (!authenticated) return;
      return json(res, 200, { projects:contextGraph.listProjects() });
    }
    if (req.method === 'POST' && url.pathname === '/api/v1/projects') {
      const authenticated = requireSession(req, res, 'workspace.write'); if (!authenticated || !requireCsrf(req,res,authenticated)) return;
      const project=contextGraph.createProject(await body(req)); ledger.append({actor:authenticated.user.id,action:'project.created',result:'success',details:{projectId:project.id}}); return json(res,201,project);
    }
    let match = url.pathname.match(/^\/api\/v1\/projects\/([^/]+)$/);
    if (match && req.method === 'PATCH') {
      const authenticated=requireSession(req,res,'workspace.write'); if(!authenticated||!requireCsrf(req,res,authenticated))return;
      return json(res,200,contextGraph.updateProject(match[1],await body(req)));
    }
    if (req.method === 'GET' && url.pathname === '/api/v1/conversations') {
      const authenticated=requireSession(req,res,'workspace.read'); if(!authenticated)return;
      return json(res,200,{conversations:contextGraph.listConversations({projectId:url.searchParams.get('projectId')})});
    }
    if (req.method === 'POST' && url.pathname === '/api/v1/conversations') {
      const authenticated=requireSession(req,res,'workspace.write'); if(!authenticated||!requireCsrf(req,res,authenticated))return;
      return json(res,201,contextGraph.createConversation(await body(req)));
    }
    // --- sessions · UI-001…UI-012 -------------------------------------------
    // The same conversations, seen from the operator's side: a working list, an archive,
    // and a bin that keeps a deleted session for its declared retention. Paging is done
    // here rather than in the browser because the range shown on the page ("11–20 of 31")
    // must come from the same count that decided the slice.
    if (req.method === 'GET' && url.pathname === '/api/v1/sessions') {
      const authenticated=requireSession(req,res,'workspace.read'); if(!authenticated)return;
      return json(res,200,contextGraph.listSessions({
        projectId:url.searchParams.get('projectId'),
        place:url.searchParams.get('place')??'active',
        page:Number(url.searchParams.get('page')??1),
        pageSize:Number(url.searchParams.get('pageSize')??10),
      }));
    }
    // One verb, any number of sessions. The interface offers a single delete button for a
    // multiple selection (UI-007), and a per-id loop in the browser would leave a partly
    // applied selection behind on the first failure with nothing saying which half moved.
    if (req.method === 'POST' && url.pathname === '/api/v1/sessions/actions') {
      const authenticated=requireSession(req,res,'workspace.write'); if(!authenticated||!requireCsrf(req,res,authenticated))return;
      const request=await body(req);
      const action=String(request.action??'');
      if(!['archive','unarchive','bin','restore','purge'].includes(action)){
        return json(res,400,{error:'action must be archive, unarchive, bin, restore or purge.',requestId});
      }
      const ids=[...new Set((Array.isArray(request.ids)?request.ids:[]).map(String))];
      if(!ids.length) return json(res,400,{error:'At least one session id is required.',requestId});
      if(ids.length>200) return json(res,413,{error:'At most 200 sessions may be moved at once.',requestId});
      const applied=[];const refused=[];
      for(const id of ids){
        try{
          if(action==='archive')applied.push(contextGraph.archiveSession(id,{archived:true}));
          else if(action==='unarchive')applied.push(contextGraph.archiveSession(id,{archived:false}));
          else if(action==='bin')applied.push(contextGraph.binSession(id));
          else if(action==='restore')applied.push(contextGraph.restoreSession(id));
          else applied.push(contextGraph.purgeSession(id));
        }catch(error){refused.push({id,status:Number(error.status??500),reason:error.message});}
      }
      ledger.append({actor:authenticated.user.id,action:`session.${action}`,result:refused.length?'partial':'success',details:{requested:ids.length,applied:applied.length,refused:refused.length}});
      // A partly applied batch answers 207: reporting 200 would hide the refusals behind a
      // success, and reporting 500 would hide the sessions that did move.
      return json(res,refused.length?(applied.length?207:400):200,{action,applied,refused});
    }
    match=url.pathname.match(/^\/api\/v1\/conversations\/([^/]+)$/);
    if(match&&req.method==='GET'){
      const authenticated=requireSession(req,res,'workspace.read');if(!authenticated)return;return json(res,200,contextGraph.getConversation(match[1]));
    }
    match=url.pathname.match(/^\/api\/v1\/conversations\/([^/]+)\/messages$/);
    if(match&&req.method==='GET'){
      const authenticated=requireSession(req,res,'workspace.read');if(!authenticated)return;
      const branchId=url.searchParams.get('branchId')??contextGraph.getConversation(match[1]).conversation.activeBranchId;
      return json(res,200,{messages:contextGraph.branchMessages(match[1],branchId),branchId});
    }
    if(match&&req.method==='POST'){
      const authenticated=requireSession(req,res,'workspace.write');if(!authenticated||!requireCsrf(req,res,authenticated))return;
      return json(res,201,contextGraph.addMessage({conversationId:match[1],...(await body(req))}));
    }
    match=url.pathname.match(/^\/api\/v1\/messages\/([^/]+)$/);
    if(match&&req.method==='PATCH'){
      const authenticated=requireSession(req,res,'workspace.write');if(!authenticated||!requireCsrf(req,res,authenticated))return;
      return json(res,200,contextGraph.editMessage({messageId:match[1],...(await body(req))}));
    }
    match=url.pathname.match(/^\/api\/v1\/messages\/([^/]+)\/exclude$/);
    if(match&&req.method==='POST'){
      const authenticated=requireSession(req,res,'workspace.write');if(!authenticated||!requireCsrf(req,res,authenticated))return;
      return json(res,200,contextGraph.setMessageExcluded({messageId:match[1],...(await body(req))}));
    }
    match=url.pathname.match(/^\/api\/v1\/messages\/([^/]+)\/regenerate$/);
    if(match&&req.method==='POST'){
      const authenticated=requireSession(req,res,'workspace.write');if(!authenticated||!requireCsrf(req,res,authenticated))return;
      return json(res,201,contextGraph.regenerateMessage({messageId:match[1],...(await body(req))}));
    }
    match=url.pathname.match(/^\/api\/v1\/conversations\/([^/]+)\/fork$/);
    if(match&&req.method==='POST'){
      const authenticated=requireSession(req,res,'workspace.write');if(!authenticated||!requireCsrf(req,res,authenticated))return;
      return json(res,201,contextGraph.fork({conversationId:match[1],...(await body(req))}));
    }
    match=url.pathname.match(/^\/api\/v1\/conversations\/([^/]+)\/merge$/);
    if(match&&req.method==='POST'){
      const authenticated=requireSession(req,res,'workspace.write');if(!authenticated||!requireCsrf(req,res,authenticated))return;
      return json(res,201,contextGraph.merge({conversationId:match[1],...(await body(req))}));
    }
    match=url.pathname.match(/^\/api\/v1\/branches\/([^/]+)\/undo$/);
    if(match&&req.method==='POST'){
      const authenticated=requireSession(req,res,'workspace.write');if(!authenticated||!requireCsrf(req,res,authenticated))return;
      return json(res,200,contextGraph.undo({branchId:match[1]}));
    }
    match=url.pathname.match(/^\/api\/v1\/conversations\/([^/]+)\/compare$/);
    if(match&&req.method==='GET'){
      const authenticated=requireSession(req,res,'workspace.read');if(!authenticated)return;
      return json(res,200,contextGraph.compareBranches(match[1],url.searchParams.get('left'),url.searchParams.get('right')));
    }
    match=url.pathname.match(/^\/api\/v1\/conversations\/([^/]+)\/context$/);
    if(match&&req.method==='GET'){
      const authenticated=requireSession(req,res,'workspace.read');if(!authenticated)return;
      return json(res,200,aiWorkspace.contextInspection({conversationId:match[1],branchId:url.searchParams.get('branchId')}));
    }
    if(req.method==='GET'&&url.pathname==='/api/v1/search'){
      const authenticated=requireSession(req,res,'workspace.read');if(!authenticated)return;
      const types=url.searchParams.get('types')?.split(',').filter(Boolean)??null;
      return json(res,200,{results:aiWorkspace.globalSearch(url.searchParams.get('q')??'',{projectId:url.searchParams.get('projectId'),types,limit:Number(url.searchParams.get('limit')??30)})});
    }
    if(req.method==='GET'&&url.pathname==='/api/v1/tasks'){
      const authenticated=requireSession(req,res,'workspace.read');if(!authenticated)return;return json(res,200,{tasks:aiWorkspace.listTasks({projectId:url.searchParams.get('projectId'),status:url.searchParams.get('status')})});
    }
    if(req.method==='POST'&&url.pathname==='/api/v1/tasks'){
      const authenticated=requireSession(req,res,'workspace.write');if(!authenticated||!requireCsrf(req,res,authenticated))return;return json(res,201,aiWorkspace.createTask({...await body(req),actorId:authenticated.user.id}));
    }
    match=url.pathname.match(/^\/api\/v1\/tasks\/([^/]+)$/);
    if(match&&req.method==='PATCH'){
      const authenticated=requireSession(req,res,'workspace.write');if(!authenticated||!requireCsrf(req,res,authenticated))return;return json(res,200,aiWorkspace.updateTask(match[1],await body(req),authenticated.user.id));
    }
    if(req.method==='GET'&&url.pathname==='/api/v1/memories'){
      const authenticated=requireSession(req,res,'workspace.read');if(!authenticated)return;return json(res,200,{memories:aiWorkspace.listMemories({projectId:url.searchParams.get('projectId'),scope:url.searchParams.get('scope')})});
    }
    if(req.method==='POST'&&url.pathname==='/api/v1/memories'){
      const authenticated=requireSession(req,res,'memory.manage');if(!authenticated||!requireCsrf(req,res,authenticated))return;return json(res,201,aiWorkspace.createMemory({...await body(req),actorId:authenticated.user.id}));
    }
    match=url.pathname.match(/^\/api\/v1\/memories\/([^/]+)$/);
    if(match&&req.method==='PATCH'){
      const authenticated=requireSession(req,res,'memory.manage');if(!authenticated||!requireCsrf(req,res,authenticated))return;return json(res,200,aiWorkspace.updateMemory(match[1],await body(req),authenticated.user.id));
    }
    if(match&&req.method==='DELETE'){
      const authenticated=requireSession(req,res,'memory.manage');if(!authenticated||!requireCsrf(req,res,authenticated))return;return json(res,200,aiWorkspace.deleteMemory(match[1],authenticated.user.id));
    }
    // --- 14_MEMORIA_A_CUBI.md, CUBE-006: the recall() contract -------------------------
    // One route, both of §11's "cerca" and "sfoglia" gestures — recall({query:''}) with
    // only filters is a browse, recall({query:'x'}) is a search. `workspace.read`, not
    // `memory.manage`: this mirrors GET /api/v1/memories above (list=read, write=manage)
    // and recall() itself never writes anything.
    if(req.method==='GET'&&url.pathname==='/api/v1/memory/recall'){
      const authenticated=requireSession(req,res,'workspace.read');if(!authenticated)return;
      try{
        const result=await memoryService.recall({
          query:url.searchParams.get('query')??'',
          cube:url.searchParams.get('cube')||null,
          project:url.searchParams.get('project')||null,
          category:url.searchParams.get('category')||null,
          since:url.searchParams.get('since')||null,
          until:url.searchParams.get('until')||null,
          limit:url.searchParams.get('limit')??20,
        },{actorId:authenticated.user.id});
        return json(res,200,result);
      }catch(error){
        if(error.status)return json(res,error.status,{error:error.message});
        throw error;
      }
    }
    if(req.method==='GET'&&url.pathname==='/api/v1/artifacts'){
      const authenticated=requireSession(req,res,'workspace.read');if(!authenticated)return;return json(res,200,{artifacts:aiWorkspace.listArtifacts({projectId:url.searchParams.get('projectId'),conversationId:url.searchParams.get('conversationId')})});
    }
    if(req.method==='POST'&&url.pathname==='/api/v1/artifacts'){
      const authenticated=requireSession(req,res,'artifact.manage');if(!authenticated||!requireCsrf(req,res,authenticated))return;return json(res,201,aiWorkspace.createArtifact({...await body(req),actorId:authenticated.user.id}));
    }
    match=url.pathname.match(/^\/api\/v1\/artifacts\/([^/]+)$/);
    if(match&&req.method==='PATCH'){
      const authenticated=requireSession(req,res,'artifact.manage');if(!authenticated||!requireCsrf(req,res,authenticated))return;return json(res,200,aiWorkspace.updateArtifact(match[1],{...await body(req),actorId:authenticated.user.id}));
    }
    if(req.method==='GET'&&url.pathname==='/api/v1/sources'){
      const authenticated=requireSession(req,res,'workspace.read');if(!authenticated)return;return json(res,200,{sources:aiWorkspace.listSources({projectId:url.searchParams.get('projectId')})});
    }
    if(req.method==='POST'&&url.pathname==='/api/v1/sources'){
      const authenticated=requireSession(req,res,'knowledge.manage');if(!authenticated||!requireCsrf(req,res,authenticated))return;return json(res,201,aiWorkspace.ingestSource({...await body(req),actorId:authenticated.user.id}));
    }
    if(req.method==='POST'&&url.pathname==='/api/v1/sources/upload'){
      const authenticated=requireSession(req,res,'knowledge.manage');if(!authenticated||!requireCsrf(req,res,authenticated))return;return json(res,201,aiWorkspace.ingestFile({...await body(req),actorId:authenticated.user.id}));
    }
    if(req.method==='GET'&&url.pathname==='/api/v1/sources/capabilities'){
      const authenticated=requireSession(req,res,'workspace.read');if(!authenticated)return;return json(res,200,extractorCapabilities());
    }
    match=url.pathname.match(/^\/api\/v1\/sources\/([^/]+)$/);
    if(match&&req.method==='GET'){
      const authenticated=requireSession(req,res,'workspace.read');if(!authenticated)return;return json(res,200,aiWorkspace.getSource(match[1]));
    }
    if(req.method==='GET'&&url.pathname==='/api/v1/knowledge/search'){
      const authenticated=requireSession(req,res,'workspace.read');if(!authenticated)return;return json(res,200,{results:aiWorkspace.knowledgeSearch(url.searchParams.get('q')??'',{projectId:url.searchParams.get('projectId'),limit:Number(url.searchParams.get('limit')??12)})});
    }
    if(req.method==='GET'&&url.pathname==='/api/v1/providers/catalog'){
      const authenticated=requireSession(req,res,'workspace.read');if(!authenticated)return;return json(res,200,{providers:providerGateway.catalog()});
    }
    if(req.method==='GET'&&url.pathname==='/api/v1/providers'){
      const authenticated=requireSession(req,res,'workspace.read');if(!authenticated)return;return json(res,200,{providers:providerGateway.list()});
    }
    if(req.method==='POST'&&url.pathname==='/api/v1/providers'){
      const authenticated=requireSession(req,res,'provider.manage');if(!authenticated||!requireCsrf(req,res,authenticated))return;const profile=providerGateway.create(await body(req));ledger.append({actor:authenticated.user.id,action:'provider.created',result:'success',details:{providerId:profile.id,type:profile.type}});return json(res,201,profile);
    }
    match=url.pathname.match(/^\/api\/v1\/providers\/([^/]+)$/);
    if(match&&req.method==='PATCH'){
      const authenticated=requireSession(req,res,'provider.manage');if(!authenticated||!requireCsrf(req,res,authenticated))return;return json(res,200,providerGateway.update(match[1],await body(req)));
    }
    match=url.pathname.match(/^\/api\/v1\/providers\/([^/]+)\/health$/);
    if(match&&req.method==='GET'){
      const authenticated=requireSession(req,res,'provider.use');if(!authenticated)return;return json(res,200,await providerGateway.probe(match[1]));
    }
    match=url.pathname.match(/^\/api\/v1\/providers\/([^/]+)\/credential$/);
    if(match&&req.method==='PUT'){
      const authenticated=requireSession(req,res,'provider.manage');if(!authenticated||!requireCsrf(req,res,authenticated))return;const request=await body(req);return json(res,200,providerGateway.setCredential(match[1],request.apiKey,{persistence:request.persistence}));
    }
    if(match&&req.method==='DELETE'){
      const authenticated=requireSession(req,res,'provider.manage');if(!authenticated||!requireCsrf(req,res,authenticated))return;return json(res,200,providerGateway.clearCredential(match[1]));
    }
    match=url.pathname.match(/^\/api\/v1\/providers\/([^/]+)\/consent$/);
    if(match&&req.method==='PUT'){
      const authenticated=requireSession(req,res,'provider.manage');if(!authenticated||!requireCsrf(req,res,authenticated))return;const consent=providerGateway.grantConsent(match[1],await body(req));ledger.append({actor:authenticated.user.id,action:'provider.consent',result:consent.consent.granted?'granted':'revoked',details:{providerId:match[1],dataClasses:consent.consent.dataClasses}});return json(res,200,consent);
    }
    if(req.method==='POST'&&url.pathname==='/api/v1/models/compare'){
      const authenticated=requireSession(req,res,'provider.use');if(!authenticated||!requireCsrf(req,res,authenticated))return;
      return json(res,200,await chatOrchestrator.compare({actorId:authenticated.user.id,...await body(req)}));
    }
    if(req.method==='POST'&&url.pathname==='/api/v1/chat/stream'){
      const authenticated=requireSession(req,res,'provider.use');if(!authenticated||!requireCsrf(req,res,authenticated))return;
      // `await`, not a bare `return`: an un-awaited promise escapes the try/catch below,
      // becomes an unhandled rejection, and Node terminates the process for it.
      return await chatOrchestrator.streamToResponse({res,actorId:authenticated.user.id,...await body(req)});
    }
    match=url.pathname.match(/^\/api\/v1\/chat\/runs\/([^/]+)\/stop$/);
    if(match&&req.method==='POST'){
      const authenticated=requireSession(req,res,'provider.use');if(!authenticated||!requireCsrf(req,res,authenticated))return;const stopped=chatOrchestrator.stop(match[1],authenticated.user.id);return json(res,stopped?200:404,{stopped,runId:match[1]});
    }
    if(req.method==='GET'&&url.pathname==='/api/v1/tools'){
      const authenticated=requireSession(req,res,'workspace.read');if(!authenticated)return;return json(res,200,{tools:aiWorkspace.snapshot().tools});
    }
    if(req.method==='POST'&&url.pathname==='/api/v1/tools'){
      const authenticated=requireSession(req,res,'agent.manage');if(!authenticated||!requireCsrf(req,res,authenticated))return;return json(res,201,agentService.registerTool(await body(req),authenticated.user.id));
    }
    match=url.pathname.match(/^\/api\/v1\/tools\/([^/]+)\/credential$/);
    if(match&&req.method==='PUT'){
      const authenticated=requireSession(req,res,'agent.manage');if(!authenticated||!requireCsrf(req,res,authenticated))return;const request=await body(req);return json(res,200,agentService.setToolCredential(match[1],request.apiKey,{persistence:request.persistence}));
    }
    match=url.pathname.match(/^\/api\/v1\/tools\/([^/]+)\/consent$/);
    if(match&&req.method==='PUT'){
      const authenticated=requireSession(req,res,'agent.manage');if(!authenticated||!requireCsrf(req,res,authenticated))return;return json(res,200,agentService.grantToolConsent(match[1],await body(req),authenticated.user.id));
    }
    if(req.method==='GET'&&url.pathname==='/api/v1/agents'){
      const authenticated=requireSession(req,res,'workspace.read');if(!authenticated)return;return json(res,200,{agents:aiStore.read().agents.filter((item)=>!item.archived)});
    }
    if(req.method==='POST'&&url.pathname==='/api/v1/agents'){
      const authenticated=requireSession(req,res,'agent.manage');if(!authenticated||!requireCsrf(req,res,authenticated))return;return json(res,201,agentService.createAgent(await body(req),authenticated.user.id));
    }
    if(req.method==='POST'&&url.pathname==='/api/v1/agent-runs'){
      const authenticated=requireSession(req,res,'agent.manage');if(!authenticated||!requireCsrf(req,res,authenticated))return;return json(res,201,agentService.createRun(await body(req),authenticated.user.id));
    }
    match=url.pathname.match(/^\/api\/v1\/agent-runs\/([^/]+)\/steps\/([^/]+)\/execute$/);
    if(match&&req.method==='POST'){
      const authenticated=requireSession(req,res,'agent.manage');if(!authenticated||!requireCsrf(req,res,authenticated))return;return json(res,200,await agentService.executeStep(match[1],match[2],await body(req),authenticated.user.id));
    }
    match=url.pathname.match(/^\/api\/v1\/agent-runs\/([^/]+)\/steps\/([^/]+)\/approve$/);
    if(match&&req.method==='POST'){
      const authenticated=requireSession(req,res,'agent.manage');if(!authenticated||!requireCsrf(req,res,authenticated))return;return json(res,200,agentService.approveStep(match[1],match[2],authenticated.user.id));
    }
    match=url.pathname.match(/^\/api\/v1\/agent-runs\/([^/]+)\/steps\/([^/]+)$/);
    if(match&&req.method==='PATCH'){
      const authenticated=requireSession(req,res,'agent.manage');if(!authenticated||!requireCsrf(req,res,authenticated))return;return json(res,200,agentService.updateStep(match[1],match[2],await body(req),authenticated.user.id));
    }
    // --- workflows -----------------------------------------------------------
    // WP-2. `/api/v1/bootstrap` advertised `Workflows` while none of this existed;
    // test/bootstrap-feature-claims.test.mjs is what caught it and now prevents it.
    //
    // Reading takes workspace.read; defining, running, deciding and cancelling take
    // agent.manage — the same permission the agent runs already use, rather than a new
    // permission invented here. The role model itself is a separate open item in the work
    // plan and is not quietly changed on the way past.
    if(req.method==='GET'&&url.pathname==='/api/v1/workflows'){
      const authenticated=requireSession(req,res,'workspace.read');if(!authenticated)return;
      return json(res,200,{
        workflows:workflowService.listWorkflows({projectId:url.searchParams.get('projectId'),includeArchived:url.searchParams.get('includeArchived')==='true'}),
        // The typed-step vocabulary travels with the list so the interface offers exactly
        // the types this build accepts, and states which of them it cannot execute.
        stepTypes:workflowService.stepTypes(),
      });
    }
    if(req.method==='POST'&&url.pathname==='/api/v1/workflows'){
      const authenticated=requireSession(req,res,'agent.manage');if(!authenticated||!requireCsrf(req,res,authenticated))return;
      return json(res,201,workflowService.createWorkflow(await body(req),authenticated.user.id));
    }
    match=url.pathname.match(/^\/api\/v1\/workflows\/([^/]+)$/);
    if(match&&req.method==='GET'){
      const authenticated=requireSession(req,res,'workspace.read');if(!authenticated)return;
      return json(res,200,workflowService.getWorkflow(match[1]));
    }
    if(match&&req.method==='PATCH'){
      const authenticated=requireSession(req,res,'agent.manage');if(!authenticated||!requireCsrf(req,res,authenticated))return;
      return json(res,200,workflowService.updateWorkflow(match[1],await body(req),authenticated.user.id));
    }
    match=url.pathname.match(/^\/api\/v1\/workflows\/([^/]+)\/runs$/);
    if(match&&req.method==='POST'){
      const authenticated=requireSession(req,res,'agent.manage');if(!authenticated||!requireCsrf(req,res,authenticated))return;
      const request=await body(req);
      const run=workflowService.createRun({workflowId:match[1],input:request.input??null,idempotencyKey:request.idempotencyKey??null,projectId:request.projectId??null},authenticated.user.id);
      // A deduplicated start is not a new resource, so it answers 200 with the run the
      // first call created rather than 201 with a second one.
      if(run.deduplicated)return json(res,200,run);
      const advanced=request.start===false?run:await workflowService.advance(run.id,authenticated.user.id);
      return json(res,201,advanced);
    }
    if(req.method==='GET'&&url.pathname==='/api/v1/workflow-runs'){
      const authenticated=requireSession(req,res,'workspace.read');if(!authenticated)return;
      return json(res,200,{runs:workflowService.listRuns({projectId:url.searchParams.get('projectId'),workflowId:url.searchParams.get('workflowId'),status:url.searchParams.get('status')})});
    }
    match=url.pathname.match(/^\/api\/v1\/workflow-runs\/([^/]+)$/);
    if(match&&req.method==='GET'){
      const authenticated=requireSession(req,res,'workspace.read');if(!authenticated)return;
      return json(res,200,workflowService.getRun(match[1]));
    }
    match=url.pathname.match(/^\/api\/v1\/workflow-runs\/([^/]+)\/advance$/);
    if(match&&req.method==='POST'){
      const authenticated=requireSession(req,res,'agent.manage');if(!authenticated||!requireCsrf(req,res,authenticated))return;
      return json(res,200,await workflowService.advance(match[1],authenticated.user.id));
    }
    match=url.pathname.match(/^\/api\/v1\/workflow-runs\/([^/]+)\/cancel$/);
    if(match&&req.method==='POST'){
      const authenticated=requireSession(req,res,'agent.manage');if(!authenticated||!requireCsrf(req,res,authenticated))return;
      return json(res,200,await workflowService.cancelRun(match[1],{reason:(await body(req)).reason??'cancelled by operator'},authenticated.user.id));
    }
    match=url.pathname.match(/^\/api\/v1\/workflow-runs\/([^/]+)\/replay$/);
    if(match&&req.method==='POST'){
      const authenticated=requireSession(req,res,'agent.manage');if(!authenticated||!requireCsrf(req,res,authenticated))return;
      const replay=workflowService.replayRun(match[1],authenticated.user.id);
      return json(res,201,await workflowService.advance(replay.id,authenticated.user.id));
    }
    match=url.pathname.match(/^\/api\/v1\/workflow-runs\/([^/]+)\/steps\/([^/]+)\/decision$/);
    if(match&&req.method==='POST'){
      const authenticated=requireSession(req,res,'agent.manage');if(!authenticated||!requireCsrf(req,res,authenticated))return;
      const request=await body(req);
      return json(res,200,await workflowService.decideApproval(match[1],match[2],{decision:request.decision,reason:request.reason??null},authenticated.user.id));
    }

    // --- the approval queue --------------------------------------------------
    // 01_PRODUCT/11 names the bottom approval strip as binding. One place to see
    // everything waiting for a human, across workflows, agent runs and staged updates.
    if(req.method==='GET'&&url.pathname==='/api/v1/approvals'){
      const authenticated=requireSession(req,res,'workspace.read');if(!authenticated)return;
      const projectId=url.searchParams.get('projectId');
      const [approvals,counts]=await Promise.all([approvalQueue.list({projectId}),approvalQueue.counts({projectId})]);
      return json(res,200,{approvals,counts});
    }
    match=url.pathname.match(/^\/api\/v1\/approvals\/([^/]+)\/decision$/);
    if(match&&req.method==='POST'){
      const authenticated=requireSession(req,res,'agent.manage');if(!authenticated||!requireCsrf(req,res,authenticated))return;
      const request=await body(req);
      const itemId=decodeURIComponent(match[1]);
      // Read the item BEFORE deciding: once decided it leaves the queue, and with it the
      // instant it became ready. UI-070 measures from that instant, so it is captured
      // here rather than reconstructed afterwards from something that looks like it.
      const pending=(await approvalQueue.list()).find((item)=>item.id===itemId)??null;
      const outcome=await approvalQueue.decide(itemId,{
        decision:request.decision,
        reason:request.reason??null,
        actorId:authenticated.user.id,
        // A staged update is Owner-only. The queue refuses it without this, and the check
        // is made here from the session rather than taken from the request body.
        isOwner:authenticated.user.role==='owner',
      });
      // Recorded for approve AND reject (UI-072). Only a decision that actually succeeded
      // is recorded: the call above throws otherwise, so a refused decision never becomes
      // review time somebody supposedly spent.
      let review=null;
      if(pending?.requestedAt){
        review=productMetric.record({
          itemId,kind:pending.kind,projectId:pending.projectId??null,
          readyAt:pending.requestedAt,decision:request.decision,actorId:authenticated.user.id,
        });
      }
      return json(res,200,{...outcome,review});
    }
    // The product's metric: human review time per decided change, rejections included.
    if(req.method==='GET'&&url.pathname==='/api/v1/metrics/review-time'){
      const authenticated=requireSession(req,res,'workspace.read');if(!authenticated)return;
      return json(res,200,productMetric.summary({
        projectId:url.searchParams.get('projectId'),
        windowDays:Number(url.searchParams.get('windowDays')??30),
      }));
    }
    // Closures — stage 16, and the NOT DONE box that cannot be silently empty (UI-036).
    if(req.method==='GET'&&url.pathname==='/api/v1/closures'){
      const authenticated=requireSession(req,res,'workspace.read');if(!authenticated)return;
      return json(res,200,{closures:closureRegister.list({projectId:url.searchParams.get('projectId')})});
    }
    if(req.method==='POST'&&url.pathname==='/api/v1/closures'){
      const authenticated=requireSession(req,res,'workspace.write');if(!authenticated||!requireCsrf(req,res,authenticated))return;
      const request=await body(req);
      return json(res,201,closureRegister.record({...request,actorId:authenticated.user.id}));
    }

    if(req.method==='GET'&&url.pathname==='/api/v1/data/export'){
      const authenticated=requireSession(req,res,'data.manage');if(!authenticated)return;return json(res,200,aiWorkspace.exportUserData());
    }
    if(req.method==='POST'&&url.pathname==='/api/v1/data/import'){
      const authenticated=requireSession(req,res,'data.manage');if(!authenticated||!requireCsrf(req,res,authenticated))return;const request=await body(req);return json(res,200,aiWorkspace.importUserData(request.bundle,{replace:Boolean(request.replace)}));
    }
    if(req.method==='POST'&&url.pathname==='/api/v1/data/purge'){
      const authenticated=requireSession(req,res,'data.manage');if(!authenticated||!requireCsrf(req,res,authenticated))return;return json(res,200,aiWorkspace.purge(await body(req)));
    }
    if(req.method==='PUT'&&url.pathname==='/api/v1/data/retention'){
      const authenticated=requireSession(req,res,'data.manage');if(!authenticated||!requireCsrf(req,res,authenticated))return;const request=await body(req);return json(res,200,aiWorkspace.updateRetention(request.days));
    }
    if(req.method==='POST'&&url.pathname==='/api/v1/data/retention/apply'){
      const authenticated=requireSession(req,res,'data.manage');if(!authenticated||!requireCsrf(req,res,authenticated))return;return json(res,200,aiWorkspace.applyRetention());
    }
    // --- settings: timezone and locale --------------------------------------
    if (req.method === 'GET' && url.pathname === '/api/v1/settings/timezone') {
      const authenticated = requireSession(req, res, 'user.read'); if (!authenticated) return;
      const browser = url.searchParams.get('browserTimezone');
      if (browser) timezoneService.recordBrowserTimezone(authenticated.user.id, browser);
      const effective = timezoneService.effectiveFor(authenticated.user.id);
      return json(res, 200, { ...effective, sample:formatInZone(Date.now(), effective.effective, timezoneService.localeFor(authenticated.user.id, req.headers['accept-language']).effective) });
    }
    if (req.method === 'PUT' && url.pathname === '/api/v1/settings/timezone') {
      const authenticated = requireSession(req, res, 'user.read');
      if (!authenticated || !requireCsrf(req, res, authenticated)) return;
      const request = await body(req);
      if (request.scope === 'server') {
        const owner = requireOwner(req, res, 'user.read'); if (!owner) return;
        return json(res, 200, timezoneService.setServerTimezone(request.timezone, { actorId:owner.user.id }));
      }
      if (request.timezone === null) return json(res, 200, timezoneService.clearUserTimezone(authenticated.user.id, { actorId:authenticated.user.id }));
      return json(res, 200, timezoneService.setUserTimezone(authenticated.user.id, request.timezone, { actorId:authenticated.user.id }));
    }
    if (req.method === 'GET' && url.pathname === '/api/v1/settings/locale') {
      const authenticated = requireSession(req, res, 'user.read'); if (!authenticated) return;
      return json(res, 200, timezoneService.localeFor(authenticated.user.id, req.headers['accept-language']));
    }
    if (req.method === 'PUT' && url.pathname === '/api/v1/settings/locale') {
      const authenticated = requireSession(req, res, 'user.read');
      if (!authenticated || !requireCsrf(req, res, authenticated)) return;
      return json(res, 200, timezoneService.setUserLocale(authenticated.user.id, (await body(req)).locale, { actorId:authenticated.user.id }));
    }

    // --- debug mode (owner only, time-boxed) --------------------------------
    if (req.method === 'GET' && url.pathname === '/api/v1/debug/status') {
      const authenticated = requireOwner(req, res, 'audit.read'); if (!authenticated) return;
      return json(res, 200, debugMode.status());
    }
    if (req.method === 'POST' && url.pathname === '/api/v1/debug/enable') {
      const authenticated = requireOwner(req, res, 'audit.read');
      if (!authenticated || !requireCsrf(req, res, authenticated)) return;
      const request = await body(req);
      return json(res, 200, debugMode.enable({ ...request, actorId:authenticated.user.id }));
    }
    if (req.method === 'POST' && url.pathname === '/api/v1/debug/disable') {
      const authenticated = requireOwner(req, res, 'audit.read');
      if (!authenticated || !requireCsrf(req, res, authenticated)) return;
      return json(res, 200, debugMode.disable({ actorId:authenticated.user.id }));
    }
    if (req.method === 'GET' && url.pathname === '/api/v1/debug/bundle') {
      const authenticated = requireOwner(req, res, 'audit.read'); if (!authenticated) return;
      const health = buildHealth({
        product:PRODUCT, watchdog, auth, authority, dataPlane, logger, updateManager,
        timezone:timezoneService.serverDefault(), debug:debugMode.status(),
      });
      return json(res, 200, debugMode.bundle({
        product:PRODUCT,
        host:{ platform:process.platform, arch:process.arch, node:process.version },
        timezone:timezoneService.effectiveFor(authenticated.user.id),
        health, watchdog:watchdog.report(), updates:updateManager.status(),
        logs:logger.search({ limit:Number(url.searchParams.get('logLimit') ?? 200) }),
      }));
    }

    // --- operational log search (owner only) --------------------------------
    if (req.method === 'GET' && url.pathname === '/api/v1/logs') {
      const authenticated = requireOwner(req, res, 'audit.read'); if (!authenticated) return;
      return json(res, 200, logger.search({
        level:url.searchParams.get('level'),
        component:url.searchParams.get('component'),
        correlationId:url.searchParams.get('correlationId'),
        event:url.searchParams.get('event'),
        text:url.searchParams.get('q'),
        since:url.searchParams.get('since'),
        until:url.searchParams.get('until'),
        limit:Math.min(Number(url.searchParams.get('limit') ?? 200), 1000),
      }));
    }

    // --- watchdog and safe mode ---------------------------------------------
    if (req.method === 'GET' && url.pathname === '/api/v1/watchdog') {
      const authenticated = requireOwner(req, res, 'audit.read'); if (!authenticated) return;
      return json(res, 200, watchdog.report());
    }
    if (req.method === 'POST' && url.pathname === '/api/v1/watchdog/run') {
      const authenticated = requireOwner(req, res, 'audit.read');
      if (!authenticated || !requireCsrf(req, res, authenticated)) return;
      await watchdog.runOnce({ force:true });
      return json(res, 200, watchdog.report());
    }
    if (req.method === 'POST' && url.pathname === '/api/v1/watchdog/safe-mode/leave') {
      const authenticated = requireOwner(req, res, 'audit.read');
      if (!authenticated || !requireCsrf(req, res, authenticated)) return;
      return json(res, 200, watchdog.leaveSafeMode({ actorId:authenticated.user.id }));
    }

    // --- update manager (owner only, never automatic) -----------------------
    if (req.method === 'GET' && url.pathname === '/api/v1/updates/status') {
      const authenticated = requireOwner(req, res, 'audit.read'); if (!authenticated) return;
      return json(res, 200, updateManager.status());
    }
    if (req.method === 'GET' && url.pathname === '/api/v1/updates/history') {
      const authenticated = requireOwner(req, res, 'audit.read'); if (!authenticated) return;
      return json(res, 200, { history:updateManager.history() });
    }
    if (req.method === 'POST' && url.pathname === '/api/v1/updates/check') {
      const authenticated = requireOwner(req, res, 'audit.read');
      if (!authenticated || !requireCsrf(req, res, authenticated)) return;
      return json(res, 200, updateManager.check({ actorId:authenticated.user.id }));
    }
    if (req.method === 'POST' && url.pathname === '/api/v1/updates/channel') {
      const authenticated = requireOwner(req, res, 'audit.read');
      if (!authenticated || !requireCsrf(req, res, authenticated)) return;
      return json(res, 200, updateManager.setChannel((await body(req)).channel, { actorId:authenticated.user.id }));
    }
    if (req.method === 'POST' && url.pathname === '/api/v1/updates/channel-key') {
      // D-0272: without this route, installChannelKey() was reachable only from a unit
      // test constructing UpdateManager directly — no operator, online or offline, could
      // ever pin a channel key on a running installation, so verifyMetadata()/verifyBundle()
      // failed NO_CHANNEL_KEY unconditionally. Strong reauthentication, same as apply: a
      // channel key is what makes update packages trusted, so pinning one carries the
      // same weight as applying one.
      const authenticated = requireOwner(req, res, 'audit.read');
      if (!authenticated || !requireCsrf(req, res, authenticated)) return;
      if (authenticated.session.elevatedUntil < Date.now()) return json(res, 403, { error:'Recent strong reauthentication is required.' });
      const { channel, publicKeyPem } = await body(req);
      return json(res, 200, updateManager.installChannelKey(channel, publicKeyPem, { actorId:authenticated.user.id }));
    }
    if (req.method === 'POST' && url.pathname === '/api/v1/updates/stage') {
      const authenticated = requireOwner(req, res, 'audit.read');
      if (!authenticated || !requireCsrf(req, res, authenticated)) return;
      return json(res, 200, updateManager.stage((await body(req)).bundle, { actorId:authenticated.user.id }));
    }
    if (req.method === 'POST' && url.pathname === '/api/v1/updates/approve') {
      const authenticated = requireOwner(req, res, 'audit.read');
      if (!authenticated || !requireCsrf(req, res, authenticated)) return;
      return json(res, 200, updateManager.approve({ ...(await body(req)), actorId:authenticated.user.id }));
    }
    if (req.method === 'POST' && url.pathname === '/api/v1/updates/apply') {
      const authenticated = requireOwner(req, res, 'audit.read');
      if (!authenticated || !requireCsrf(req, res, authenticated)) return;
      // Strong reauthentication, as for any other irreversible owner action.
      if (authenticated.session.elevatedUntil < Date.now()) return json(res, 403, { error:'Recent strong reauthentication is required.' });
      return json(res, 200, await updateManager.apply({ actorId:authenticated.user.id }));
    }
    if (req.method === 'POST' && url.pathname === '/api/v1/updates/rollback') {
      const authenticated = requireOwner(req, res, 'audit.read');
      if (!authenticated || !requireCsrf(req, res, authenticated)) return;
      return json(res, 200, await updateManager.rollback({ actorId:authenticated.user.id, reason:(await body(req)).reason ?? 'manual' }));
    }

    if (req.method === 'GET' && url.pathname === '/api/v1/audit') {
      const authenticated = requireSession(req, res, 'audit.read'); if (!authenticated) return;
      return json(res, 200, { valid:ledger.verify(), events:ledger.readAll().slice(-100) });
    }
    if (req.method === 'GET' && url.pathname === '/api/v1/bootstrap') {
      const authenticated = requireSession(req, res, 'user.read'); if (!authenticated) return;
      return json(res, 200, {
        product:{ name:'NOESAR Evolution', edition:'Open Core Source Implementation', version:'1.0.0' },
        authority,
        dataPlane,
        user:authenticated.user,
        privacy:(() => { const p = currentPrivacy(authenticated.user); return { ...p, banner:privacyBanner(p.state) }; })(),
        hardware,
        runtimeRecommendation:recommendRuntime(hardware, {}),
        // SEC-003. The invariant declaration travels with the bootstrap so the interface
        // renders what this build actually enforces. The panel used to hardcode five
        // invariants of its own, which matched neither each other nor the seven the
        // planner declares — two independent claims, neither derived from the code.
        coden:{ modes:authenticated.user.role === 'owner' ? ['NORMAL','OWNER_BYPASS'] : ['NORMAL'], executionEnabled:false, explanation:'Planning and scoped authorization are implemented; host mutation remains disabled.', invariants:INVARIANT_ENFORCEMENT },
        features:['Ask','Create','Act','Versioned Context Graph','Projects','Documents','Artifacts','Agents','Workflows','CodeN Evolution','Knowledge','Memory','Local and External Providers','MCP and OpenAPI Tools','Compute & Hardware','Data Export and Retention','Update Center'],
      });
    }

    // --- multi-user administration -------------------------------------------
    // Every mutating route here requires user.manage, which only owner and admin hold,
    // plus the CSRF header. The directory itself enforces the narrower rules — an
    // administrator may not mint an owner, nor disable the last one — so a future route
    // cannot grant more than the permission name suggests.
    if (req.method === 'GET' && url.pathname === '/api/v1/admin/users') {
      const authenticated = requireSession(req, res, 'user.manage'); if (!authenticated) return;
      // The role vocabulary travels with the directory so the interface offers exactly
      // the roles this build accepts, rather than a copy that can fall behind it.
      return json(res, 200, {
        users:userDirectory.list(),
        roles:ROLES.map((role) => ({ role, mfaRequired:MFA_REQUIRED_ROLES.has(role) })),
      });
    }
    if (req.method === 'GET' && url.pathname === '/api/v1/admin/invitations') {
      const authenticated = requireSession(req, res, 'user.manage'); if (!authenticated) return;
      return json(res, 200, { invitations:userDirectory.listInvitations() });
    }
    if (req.method === 'POST' && url.pathname === '/api/v1/admin/invitations') {
      const authenticated = requireSession(req, res, 'user.manage');
      if (!authenticated || !requireCsrf(req, res, authenticated)) return;
      const payload = await body(req);
      const created = userDirectory.createInvitation({ actorId:authenticated.user.id, ...payload });
      // The token is in the response and nowhere else: it is not logged, not stored in
      // cleartext, and cannot be read back from any later request.
      return json(res, 201, { ...created, note:'This token is shown once. It cannot be retrieved again.' });
    }
    {
      const match = url.pathname.match(/^\/api\/v1\/admin\/invitations\/([0-9a-f-]{36})$/);
      if (match && req.method === 'DELETE') {
        const authenticated = requireSession(req, res, 'user.manage');
        if (!authenticated || !requireCsrf(req, res, authenticated)) return;
        return json(res, 200, userDirectory.revokeInvitation({
          actorId:authenticated.user.id, invitationId:match[1],
        }));
      }
    }
    // Invitation acceptance is unauthenticated by necessity — the account does not exist
    // yet — and is protected by the one-time token instead.
    if (req.method === 'POST' && url.pathname === '/api/v1/auth/invitation/accept') {
      return json(res, 200, userDirectory.acceptInvitation(await body(req)));
    }
    if (req.method === 'POST' && url.pathname === '/api/v1/auth/invitation/confirm') {
      const confirmed = userDirectory.confirmInvitationMfa(await body(req));
      // A session is established here for the same reason first-owner setup establishes
      // one: the caller has just presented the invitation token, chosen a password and
      // proved possession of the TOTP secret. That is a complete authentication, and
      // making them log in again immediately afterwards adds a step without adding a
      // check.
      const record = userDirectory.find(confirmed.user.id);
      return sessionResponse(req, res, auth.createSession(record, { mfa:true }), 201);
    }
    {
      const match = url.pathname.match(/^\/api\/v1\/admin\/users\/([0-9a-f-]{36})(\/[a-z-]+)?$/);
      if (match) {
        const userId = match[1];
        const action = (match[2] ?? '').replace('/', '');
        const authenticated = requireSession(req, res, 'user.manage'); if (!authenticated) return;
        if (req.method === 'GET' && action === '') {
          const found = userDirectory.list().find((user) => user.id === userId);
          return json(res, found ? 200 : 404, found ?? { error:'No such account.' });
        }
        if (req.method === 'GET' && action === 'export') {
          return json(res, 200, userDirectory.exportUser({ userId }));
        }
        if (req.method === 'GET' && action === 'events') {
          return json(res, 200, {
            events:userDirectory.administrativeEvents({ subjectUserId:userId, limit:200 }),
          });
        }
        if (!requireCsrf(req, res, authenticated)) return;
        const payload = req.method === 'DELETE' ? {} : await body(req);
        if (req.method === 'POST' && action === 'role') {
          return json(res, 200, userDirectory.setRole({
            actorId:authenticated.user.id, userId, role:payload.role,
          }));
        }
        if (req.method === 'POST' && action === 'disable') {
          return json(res, 200, userDirectory.disableUser({
            actorId:authenticated.user.id, userId, reason:payload.reason ?? null,
          }));
        }
        if (req.method === 'POST' && action === 'revoke') {
          return json(res, 200, userDirectory.revokeUser({
            actorId:authenticated.user.id, userId, reason:payload.reason ?? null,
          }));
        }
        if (req.method === 'POST' && action === 'reinstate') {
          return json(res, 200, userDirectory.reinstateUser({ actorId:authenticated.user.id, userId }));
        }
        if (req.method === 'POST' && action === 'tokens') {
          return json(res, 201, userDirectory.issueServiceToken({
            actorId:authenticated.user.id, userId, name:payload.name, ttlDays:payload.ttlDays ?? null,
          }));
        }
        if (req.method === 'DELETE' && action === '') {
          return json(res, 200, userDirectory.eraseUser({
            actorId:authenticated.user.id, userId, reason:payload.reason ?? null,
          }));
        }
      }
    }
    if (req.method === 'POST' && url.pathname === '/api/v1/admin/service-accounts') {
      const authenticated = requireSession(req, res, 'user.manage');
      if (!authenticated || !requireCsrf(req, res, authenticated)) return;
      const created = userDirectory.createServiceAccount({
        actorId:authenticated.user.id, ...(await body(req)),
      });
      return json(res, 201, { ...created, note:'This token is shown once. It cannot be retrieved again.' });
    }
    {
      const match = url.pathname.match(/^\/api\/v1\/admin\/service-tokens\/([0-9a-f-]{36})$/);
      if (match && req.method === 'DELETE') {
        const authenticated = requireSession(req, res, 'user.manage');
        if (!authenticated || !requireCsrf(req, res, authenticated)) return;
        return json(res, 200, userDirectory.revokeServiceToken({
          actorId:authenticated.user.id, tokenId:match[1],
        }));
      }
    }
    if (req.method === 'GET' && url.pathname === '/api/v1/admin/events') {
      const authenticated = requireSession(req, res, 'audit.read'); if (!authenticated) return;
      return json(res, 200, {
        events:userDirectory.administrativeEvents({ limit:Number(url.searchParams.get('limit') ?? 100) }),
      });
    }

    // --- local model runtime --------------------------------------------------
    if (req.method === 'GET' && url.pathname === '/api/v1/runtime/local-model') {
      const authenticated = requireSession(req, res, 'hardware.read'); if (!authenticated) return;
      return json(res, 200, localModels.status());
    }
    if (req.method === 'GET' && url.pathname === '/api/v1/runtime/local-model/profiles') {
      const authenticated = requireSession(req, res, 'hardware.read'); if (!authenticated) return;
      return json(res, 200, await localModels.profiles());
    }
    if (req.method === 'GET' && url.pathname === '/api/v1/runtime/local-model/selection') {
      const authenticated = requireSession(req, res, 'hardware.read'); if (!authenticated) return;
      const required = url.searchParams.get('requiredVramMiB');
      return json(res, 200, await localModels.select({
        requiredVramMiB:required ? Number(required) : null,
      }));
    }
    if (req.method === 'PUT' && url.pathname === '/api/v1/runtime/local-model') {
      const authenticated = requireSession(req, res, 'model.manage');
      if (!authenticated || !requireCsrf(req, res, authenticated)) return;
      return json(res, 200, await localModels.configure(await body(req)));
    }
    if (req.method === 'POST' && url.pathname === '/api/v1/runtime/local-model/attach') {
      const authenticated = requireSession(req, res, 'model.manage');
      if (!authenticated || !requireCsrf(req, res, authenticated)) return;
      return json(res, 200, await localModels.attach());
    }
    if (req.method === 'POST' && url.pathname === '/api/v1/runtime/local-model/launch') {
      const authenticated = requireSession(req, res, 'model.manage');
      if (!authenticated || !requireCsrf(req, res, authenticated)) return;
      const nowUnix = Math.floor(Date.now() / 1000);
      const payload = await body(req);
      try {
        return json(res, 202, await localModels.launch({ capabilityToken: payload?.capabilityToken ?? null, nowUnix }));
      } catch (error) {
        if (error?.status) return json(res, error.status, { error: 'launch_refused', reason: error.message });
        throw error;
      }
    }
    if (req.method === 'POST' && url.pathname === '/api/v1/runtime/local-model/release') {
      const authenticated = requireSession(req, res, 'model.manage');
      if (!authenticated || !requireCsrf(req, res, authenticated)) return;
      return json(res, 200, await localModels.release());
    }
    if (req.method === 'POST' && url.pathname === '/api/v1/runtime/local-model/complete') {
      const authenticated = requireSession(req, res, 'provider.use');
      if (!authenticated || !requireCsrf(req, res, authenticated)) return;
      return json(res, 200, await localModels.complete(await body(req)));
    }

    // --- adapter capability grants (ARCH-005) ----------------------------------
    // A manifest is a request: this is the only route that mints a token an adapter's
    // privileged method (today, only LocalModelRuntime.launch()) will accept. Same
    // permission ('model.manage') as the local-model routes above, because asking to
    // launch the local model runtime is exactly the action being gated.
    if (req.method === 'GET' && url.pathname === '/api/v1/adapters') {
      const authenticated = requireSession(req, res, 'hardware.read'); if (!authenticated) return;
      return json(res, 200, adapterCapabilityStatus());
    }
    if (req.method === 'POST' && url.pathname.match(/^\/api\/v1\/adapters\/[^/]+\/grants$/)) {
      const authenticated = requireSession(req, res, 'model.manage');
      if (!authenticated || !requireCsrf(req, res, authenticated)) return;
      const resource = decodeURIComponent(url.pathname.split('/')[4]);
      const payload = await body(req);
      const nowUnix = Math.floor(Date.now() / 1000);
      try {
        const granted = adapterGrants.request({
          resource, operation: payload?.operation, actor: authenticated.user.id, nowUnix,
        });
        return json(res, 201, granted);
      } catch (error) {
        if (error instanceof AdapterCapabilityError) {
          return json(res, error.kind === 'UNKNOWN_ADAPTER' ? 404 : 422,
            { error: 'adapter_grant_refused', kind: error.kind, reason: error.message });
        }
        throw error;
      }
    }
    const adapterGrantMatch = url.pathname.match(/^\/api\/v1\/adapters\/grants\/([^/]+)\/(approve|reject)$/);
    if (adapterGrantMatch && req.method === 'POST') {
      const authenticated = requireSession(req, res, 'model.manage');
      if (!authenticated || !requireCsrf(req, res, authenticated)) return;
      const [, runId, verb] = adapterGrantMatch;
      const payload = await body(req);
      const nowUnix = Math.floor(Date.now() / 1000);
      try {
        if (verb === 'approve') {
          return json(res, 200, adapterGrants.approve({ runId, approverId: authenticated.user.id, nowUnix }));
        }
        return json(res, 200, adapterGrants.reject({
          runId, approverId: authenticated.user.id, reason: payload?.reason ?? null, nowUnix,
        }));
      } catch (error) {
        if (error instanceof AdapterCapabilityError) {
          return json(res, 422, { error: 'adapter_grant_refused', kind: error.kind, reason: error.message });
        }
        throw error;
      }
    }

    // --- database -------------------------------------------------------------
    if (req.method === 'GET' && url.pathname === '/api/v1/database/status') {
      const authenticated = requireSession(req, res, 'audit.read'); if (!authenticated) return;
      if (!postgres) return json(res, 200, { mode:dataPlane.mode, postgresql:null });
      return json(res, 200, { mode:dataPlane.mode, postgresql:postgres.status(), health:await postgres.health() });
    }
    if (req.method === 'POST' && url.pathname === '/api/v1/database/backup') {
      const authenticated = requireOwner(req, res, 'data.manage');
      if (!authenticated || !requireCsrf(req, res, authenticated)) return;
      if (!postgres) return json(res, 409, { error:'No PostgreSQL data plane is active.' });
      const payload = await body(req);
      return json(res, 201, await postgres.backup({ label:payload.label ?? null }));
    }

    if (req.method === 'GET' && serveStatic(url.pathname, res)) return;
    // Card D (s313/s317 addendum): an address like /coden/bench/diff has to answer when
    // typed straight into the browser bar, not just when reached through the app's own
    // in-page `/` box — "digitabile nella barra del browser" was the literal ask. Gated to
    // path-shaped requests: a dot in the final segment (.js, .png, a mistyped asset) still
    // 404s instead of silently turning a missing file into an HTML page. Everything under
    // /api/ is excluded so this can never shadow a real endpoint, checked against the full
    // route table before this was added (no non-API route collides with /coden/*).
    // One handler, reusing serveStatic's own index.html branch — not a second file read.
    if (req.method === 'GET' && !url.pathname.startsWith('/api/') && !/\.[^/]+$/.test(url.pathname) && serveStatic('/', res)) return;
    return json(res, 404, { error:'Not found', requestId });
  } catch (error) {
    const status = Number(error.status ?? 500);
    ledger.append({ actor:'system', action:'request.error', result:'error', details:{ requestId, status, message:error.message } });
    logger.log(status >= 500 ? 'ERROR' : 'WARN', 'http.request.failed', {
      correlation_id:requestId, component:'control-plane',
      http:{ method:req.method, path:url.pathname, status }, error:error.message,
    });
    return json(res, status, { error:status >= 500 ? 'Internal request failure.' : error.message, requestId });
  }
};

const server = mainListenerIsTls
  ? createHttpsServer({ cert: tls.cert, key: tls.key }, requestListener)
  : createServer(requestListener);

/** The LAN-facing TLS listener, when one is configured. Same request handler, same everything —
 *  only the transport differs, so there is no second product behind it and no second set of
 *  rules to keep in step. */
const tlsServer = tlsPort && tls.active
  ? createHttpsServer({ cert: tls.cert, key: tls.key }, requestListener)
  : null;

// Last resort, not a substitute for handling errors where they happen.
//
// A rejection that reaches this point is a bug, and it is reported as one — but a
// self-hosted single-process product must not die because one request threw. Node's
// default for an unhandled rejection is to terminate; that turned a malformed body
// into a service outage. An uncaught exception is treated differently: the process
// state may be inconsistent, so it exits non-zero and lets the supervisor restart it,
// where the crash-loop detector and safe mode can see it.
process.on('unhandledRejection', (reason) => {
  const error = reason instanceof Error ? reason : new Error(String(reason));
  logger.error('process.unhandled-rejection', {
    component:'control-plane', error:error.message, stack:error.stack?.split('\n').slice(0, 6).join(' | '),
    note:'request-scoped failure contained; this is a defect, not a normal path',
  });
});
process.on('uncaughtException', (error) => {
  logger.error('process.uncaught-exception', {
    component:'control-plane', error:error.message, stack:error.stack?.split('\n').slice(0, 6).join(' | '),
    note:'process state may be inconsistent; exiting so the supervisor can restart cleanly',
  });
  process.exit(1);
});

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  // The unix socket half of the session protocol — a real terminal's transport, never the
  // browser's (that is the HTTP bridge below). Guarded to the entrypoint like the HTTP
  // listener itself: a test importing this module gets an unstarted dispatch to call
  // directly, not a socket file it did not ask for and would have to clean up.
  //
  // ARCH-001, `codev` peer: this process no longer listens on the externally-reachable
  // path (NOESAR_TUI_SOCKET_PATH, bind-mounted to the host as tui.sock) — that socket now
  // belongs to the separate `codev` OS process (bin/codev-child.mjs), which relays bytes
  // 1:1 to THIS internal-only socket. Moving the listen path is the entire change; the
  // dispatch/auth/ledger instances below are unchanged, still owned exclusively by `api` —
  // `codev` carries no business logic, so there is still exactly one engine, now reached by
  // a third, OS-level-isolated transport instead of a second copy of it. Under /run (the
  // tmpfs INST-004 restores): container-local, never bind-mounted, invisible outside the
  // container, gone on restart — a peer socket has no reason to survive one.
  const codevPeerSocketPath = process.env.NOESAR_CODEV_PEER_SOCKET_PATH ?? '/run/codev-peer.sock';
  try {
    // Awaited since s326, so the line below is a fact rather than a forecast: it used to be
    // logged while the socket was still on its way to listening.
    await startUnixSocketServer({ socketPath: codevPeerSocketPath, dispatch: sessionDispatch, auth, ledger });
    logger.info('tui.socket-listening', { component:'session-protocol', path: codevPeerSocketPath });
  } catch (error) {
    // A live peer already owns this path. Refusing to steal it is the point (see
    // reclaimSocketPath), but this process still serves HTTP, so it comes up WITHOUT the
    // terminal transport and says exactly that — the product's standing posture on
    // degradation: continue, and declare it. Silence here would look like a healthy
    // installation whose `ssh` terminal merely "does not work".
    logger.error('tui.socket-unavailable', {
      component:'session-protocol', path: codevPeerSocketPath,
      kind: error.kind ?? 'ERROR', error: error.message,
      note:'HTTP is served; the terminal transport is not, because another process holds this socket',
    });
  }

  // D-0283: the port opens here only if the module is active right now; from then on the
  // lifecycle routes open and close it. Nothing listens for a module that is not installed.
  startModuleConsoleProxy();

  // Opened BEFORE the plain listener reports ready, so an installation that is meant to be
  // reached over TLS is never briefly reachable only in plaintext. A failure here is logged and
  // does not take the process down: the product's standing posture is continue-and-declare, and
  // an installation that lost its TLS port but kept serving the module is still doing work.
  if (tlsServer) {
    tlsServer.on('error', (error) => {
      logger.error('tls-listener.failed', {
        component:'control-plane', port:tlsPort, error:error.message,
        note:'the LAN-facing TLS listener did not open; a browser cannot open a microphone against this installation',
      });
    });
    tlsServer.listen(tlsPort, host, () => {
      logger.info('tls-listener.started', {
        component:'control-plane', port:tlsPort,
        note:'TLS faces the network; the plain listener stays for the private container network',
      });
    });
  }

  server.listen(port, host, async () => {
    logger.info('runtime.started', {
      // The bind address is described rather than printed: the sink redacts IPv4
      // literals by product policy, which would turn it into [REDACTED_IP] and make
      // the line useless for the operator who needs it.
      component:'control-plane', port,
      // `bind_scope` is what this process listens on INSIDE its namespace, which in a
      // container is always all-interfaces and therefore says nothing about who can
      // reach it. `exposure_scope` is what the operator published it on OUTSIDE, and
      // it is what the /metrics gate keys off. Neither field carries an address: the
      // sink redacts IPv4 literals, so printing one produces [REDACTED_IP].
      bind_scope: host === '0.0.0.0' || host === '::' ? 'all-interfaces' : 'single-interface',
      exposure_scope:exposureScope,
      metrics_requires_authentication:exposureScope !== 'loopback',
      version:PRODUCT.releaseVersion,
      release_channel:process.env.NOESAR_RELEASE_CHANNEL ?? 'complete',
      data_plane:dataPlane.mode ?? 'reference-json',
      timezone:timezoneService.serverDefault().effective,
      timezone_source_tier:timezoneService.serverDefault().sourceTier,
      safe_mode:watchdog.safeMode.active,
      tls_active:tls.active,
      secure_cookies:secureCookies,
      trust_anchor:trustAnchor.available ? 'published' : 'none',
    });
    // The fingerprint gets its own line, at a level that survives a busy log, because it is
    // one half of a comparison a person has to make by eye on a different device. /ca serves
    // the other half over a connection nothing has authenticated yet — a line an operator
    // reads here, from the process itself, is what makes that comparison worth making.
    if (trustAnchor.available) {
      logger.log('INFO', 'trust-anchor.published', {
        component:'control-plane', source:trustAnchor.source, subject:trustAnchor.subject,
        fingerprint_sha256:trustAnchor.fingerprintSha256, not_after:trustAnchor.notAfter,
        note:'served at /ca — compare this fingerprint on the device before installing',
      });
    } else if (tls.active) {
      // Only worth saying when TLS is on: on a plaintext installation "no anchor" is not a
      // finding, it is the configuration. With TLS on it means devices cannot be given the
      // one file that lets them reach this listener without a warning.
      logger.warn('trust-anchor.unavailable', { component:'control-plane', reason:trustAnchor.reason });
    }
    if (setupTokenState.source === 'file') {
      // Path and fingerprint only. The token itself is never written to a log.
      logger.warn('setup-token.available', {
        component:'auth', path:setupTokenState.path,
        generated:setupTokenState.generated, setup_fingerprint:setupTokenState.fingerprint,
        note:'first-owner setup token; read it from this file on the host',
      });
    } else if (setupTokenState.source === 'none' && !auth.status().initialized) {
      logger.error('setup-token.unavailable', {
        component:'auth',
        note:'first-run setup cannot proceed: set NOESAR_SETUP_TOKEN_FILE',
      });
    }
    // The database is brought up AFTER the listener, on purpose. /livez must answer from
    // the first moment so the container's health check never kills a process that is
    // legitimately still starting a cluster; /readyz reports not-ready throughout, which
    // is exactly the distinction those two endpoints exist to draw.
    if (postgres) {
      try {
        await postgres.start();
        const health = await postgres.health();
        dataPlane = describeDataPlane({ env:process.env, supervisor:postgres, health });
        logger.info('data-plane.ready', {
          component:'data-plane', mode:dataPlane.mode,
          server_version:health.serverVersion, pgvector:health.pgvectorVersion,
          migrations:health.migrationCount, rls_tables:health.rlsTables,
          production_ready:health.productionReady,
        });
        const projection = await userDirectory.projectToDataPlane();
        logger.info('data-plane.identity-projected', { component:'data-plane', ...projection });
        // 14_MEMORIA_A_CUBI.md, D-0263: the same "projection, not migration" idea as
        // identity above — one canonical workspace, idempotent, so memory has somewhere
        // to be RLS-scoped to. Runs after the identity projection on purpose: it needs an
        // owner already in noesar_identity.users to attach the workspace to.
        const workspaceProjection = await memoryService.ensureWorkspace();
        logger.info('data-plane.workspace-projected', { component:'data-plane', ...workspaceProjection });
      } catch (error) {
        // Fail closed and loudly. A runtime that could not open its declared data plane
        // must not fall back to writing JSON files that nobody will ever read again.
        logger.error('data-plane.failed', {
          component:'data-plane', error:error.message,
          stack:error.stack?.split('\n').slice(0, 6).join(' | '),
          note:'the declared PostgreSQL data plane did not start; refusing to serve against a substitute',
        });
        process.exitCode = 1;
        server.close(() => process.exit(1));
        return;
      }
    }

    await watchdog.runOnce({ force:true }).catch(() => {});
    watchdog.start(Number(process.env.NOESAR_WATCHDOG_INTERVAL_MS ?? 15_000));
    // Debug sessions expire on their own even when no request arrives.
    const sweeper = setInterval(() => debugMode.sweep(), 30_000);
    sweeper.unref?.();
    let stopping = false;
    for (const signal of ['SIGTERM', 'SIGINT']) {
      process.on(signal, () => {
        // A second signal during shutdown must not start a second shutdown: two
        // concurrent stops of the same cluster is how a checkpoint gets interrupted.
        if (stopping) return;
        stopping = true;
        logger.warn('runtime.stopping', { component:'control-plane', signal });
        watchdog.stop();
        moduleConsoleProxyServer?.close();
        // Closed alongside the others, not left for the process exit: a listener still
        // accepting connections while PostgreSQL is being stopped answers requests against a
        // data plane that is going away, which is the shape of the s334 outage seen from the
        // other end.
        tlsServer?.close();
        server.close(async () => {
          try {
            await localModels.release();
            if (postgres) await postgres.stop();
          } catch (error) {
            logger.error('runtime.stop-failed', { component:'control-plane', error:error.message });
          }
          process.exit(0);
        });
      });
    }
  });
}
// D-0283: the console proxy is created on activation and discarded on uninstall, so the
// binding itself changes over the process's life — exported as accessors, because a
// destructured import would capture whatever `null` happened to be there at import time.
export function getModuleConsoleProxyServer() { return moduleConsoleProxyServer; }
export function isModuleConsoleProxyListening() { return moduleConsoleProxyListening; }
export { server, startModuleConsoleProxy, stopModuleConsoleProxy, logger, watchdog, debugMode, updateManager, timezoneService, metrics, tls, secureCookies };
