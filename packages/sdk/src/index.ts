// SPDX-License-Identifier: Apache-2.0

export type Role = "owner" | "admin" | "developer" | "user";
export type TrustLevel =
  | "noesar-official"
  | "certified-partner"
  | "customer-private"
  | "community";

export interface IdentityContext {
  actorId: string;
  role: Role;
  sessionId: string;
  organizationId: string;
  projectId?: string;
  strongReauthenticated: boolean;
}

export type CapabilityKind =
  | "app" | "tool" | "skill" | "connector" | "agent" | "workflow"
  | "document-processor" | "runtime-adapter" | "hardware-adapter"
  | "policy-pack" | "compliance-pack" | "industry-module";

export type Permission =
  | "filesystem.read.project"
  | "filesystem.write.project"
  | "filesystem.host"
  | "network.external"
  | "secret.read"
  | "shell.execute"
  | "model.download"
  | "runtime.install"
  | "memory.read"
  | "memory.write"
  | "memory.promote"
  | "camera.read"
  | "microphone.read"
  | "physical.actuate";

export interface CapabilityManifest {
  schemaVersion: "4.0";
  id: string;
  version: string;
  kind: CapabilityKind;
  publisher: {
    id: string;
    trustLevel: TrustLevel;
    keyId?: string;
  };
  license: {
    spdx: string;
    commercialUse?: boolean;
    noticeFile?: string;
  };
  entrypoint: {
    type:
      | "builtin" | "declarative" | "wasi" | "native-worker"
      | "python-worker" | "mcp" | "a2a";
    value: string;
    protocolVersion?: string;
  };
  permissions: Permission[];
  payload: Array<{ path: string; sha256: string; bytes: number }>;
  industry?: {
    riskClass: "standard" | "elevated" | "high" | "safety-critical";
    intendedUse: string[];
    excludedUse: string[];
    evidence: Array<{ type: string; reference: string; sha256: string }>;
  };
}

export interface CapabilityPlan {
  capabilityId: string;
  version: string;
  decision: "allow" | "approval-required" | "deny";
  reasons: string[];
  permissions: Permission[];
  planHash: string;
  sandboxProfile: string;
  actorId: string;
  role: Role;
  sessionId: string;
  organizationId: string;
  projectId?: string;
  strongReauthRequired: boolean;
}

export interface PublisherRecord {
  publisherId: string;
  trustLevel: TrustLevel;
  fingerprintSha256: string;
  status: "active" | "revoked";
}


export type SandboxProfile =
  | "declarative"
  | "process-restricted-development-fixture"
  | "os-isolated"
  | "blocked";

export interface ResourceLimits {
  cpuSeconds: number;
  wallSeconds: number;
  memoryBytes: number;
  fileBytes: number;
  stdoutBytes: number;
  openFiles: number;
  processes: number;
}

export interface SandboxAttestation {
  schemaVersion: "1.0";
  kind: "capability-os-sandbox";
  profileSha256: string;
  platform: string;
  kernel: string;
  userNamespace: true;
  mountNamespace: true;
  pidNamespace: true;
  networkNamespace: true;
  ipcNamespace: true;
  utsNamespace: true;
  seccomp: true;
  resourceLimits: true;
  filesystemIsolation: true;
  escapeTestsPassed: true;
  testReportSha256: string;
  createdUtc: string;
}

export interface CapabilityExecutionRequest {
  capabilityId: string;
  version: string;
  actorId: string;
  sessionId: string;
  planHash: string;
  profile: SandboxProfile;
  argv: string[];
  permissions: Permission[];
  limits: ResourceLimits;
}

export interface CapabilityExecutionReceipt {
  executionId: string;
  profile: SandboxProfile;
  exitCode?: number;
  timedOut: boolean;
  durationMs: number;
  workspaceDestroyed: boolean;
  networkEnforcement: string;
  commandSha256: string;
}


export type CapabilityIpcAction =
  | "capability.plan"
  | "capability.approve"
  | "capability.execute"
  | "capability.disable"
  | "capability.rollback"
  | "capability.status";

export interface CapabilityIpcEnvelopeV2 {
  schemaVersion: "2.0";
  actorId: string;
  sessionId: string;
  action: CapabilityIpcAction;
  payload: Record<string, unknown>;
  nonce: string;
  issuedAt: number;
  expiresAt: number;
  planHash: string | null;
  capabilityId: string | null;
  capabilityVersion: string | null;
  signature: string;
}

export interface ProductionSandboxAttestationV2 {
  schemaVersion: "2.0";
  kind: "capability-os-sandbox";
  release: "0.4.0";
  profile: "os-isolated";
  profileSha256: string;
  capabilityId: string;
  capabilityVersion: string;
  adapter:
    | "bubblewrap"
    | "linux-namespace-seccomp-launcher"
    | "windows-appcontainer"
    | "macos-sandbox-exec"
    | "wasi-preview2";
  launcherPath: string;
  launcherSha256: string;
  seccompProfilePath: string;
  seccompProfileSha256: string;
  escapeTestReportPath: string;
  escapeTestReportSha256: string;
  platform: string;
  kernel: string;
  noNewPrivileges: true;
  userNamespace: true;
  uidMapRestricted: true;
  gidMapRestricted: true;
  mountNamespace: true;
  pidNamespace: true;
  networkNamespace: true;
  ipcNamespace: true;
  utsNamespace: true;
  seccomp: true;
  resourceLimits: true;
  filesystemIsolation: true;
  processIsolation: true;
  escapeTestsPassed: true;
  networkPolicy: "deny-by-default";
  filesystemPolicy: "allowlisted-readonly-root";
  createdUtc: string;
}


export interface CapabilityProductionEvidenceV1 {
  schemaVersion: "1.0";
  kind: "capability-production-evidence";
  release: "0.5.0";
  capabilityId: string;
  capabilityVersion: string;
  planHash: string;
  profileSha256: string;
  authorityProtocolVersion: "1.1";
  runtimeVersion: "0.5.0";
  capabilityPackageSha256: string;
  policyDecisionSha256: string;
  authorityAttestationSha256: string;
  postgresAttestationSha256: string;
  sandboxAttestationSha256: string;
  runtimeReadinessSha256: string;
}

export interface CapabilityExecutionTicketV1 {
  schemaVersion: "1.0";
  kind: "capability-execution-ticket";
  release: "0.5.0";
  ticketId: string;
  nonce: string;
  actorId: string;
  sessionId: string;
  capabilityId: string;
  capabilityVersion: string;
  planHash: string;
  sandboxProfile: string;
  productionEligible: true;
  evidenceSha256: string;
  authorityAttestationSha256: string;
  postgresAttestationSha256: string;
  sandboxAttestationSha256: string;
  policyDecisionSha256: string;
  capabilityPackageSha256: string;
  runtimeReadinessSha256: string;
  issuedAt: number;
  expiresAt: number;
  signature: string;
}


export interface ProductionSandboxAttestationV3 {
  schemaVersion: "3.0";
  kind: "capability-os-sandbox";
  release: "0.5.0";
  profile: "os-isolated";
  profileSha256: string;
  capabilityId: string;
  capabilityVersion: string;
  planHash: string;
  authorityProtocolVersion: "1.1";
  runtimeVersion: "0.5.0";
  launcherSha256: string;
  seccompProfileSha256: string;
  escapeTestReportSha256: string;
  authorityAttestationSha256: string;
  postgresAttestationSha256: string;
  capabilityPackageSha256: string;
  policyDecisionSha256: string;
  runtimeReadinessSha256: string;
}
