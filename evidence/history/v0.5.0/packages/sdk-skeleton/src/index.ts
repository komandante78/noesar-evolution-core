// SPDX-License-Identifier: Apache-2.0
export interface NoesarModuleManifest {
  id: string;
  version: string;
  publisher: string;
  trustLevel: 'NOESAR_OFFICIAL' | 'CERTIFIED_PARTNER' | 'CUSTOMER_PRIVATE' | 'COMMUNITY';
  permissions: string[];
  entrypoints: Record<string, string>;
  payloadSha256: string;
  signature?: string;
}

export interface RuntimeAdapterDescriptor {
  id: string;
  vendor: string;
  backend: string;
  platforms: string[];
  capabilities: string[];
  requiresHostBridge: boolean;
}

export interface PathAuthorizationPlan {
  canonicalPath: string;
  risk: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  consentOptions: string[];
  backupRequired: boolean;
  nonBypassableInvariants: string[];
}
