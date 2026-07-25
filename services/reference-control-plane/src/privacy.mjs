// SPDX-License-Identifier: AGPL-3.0-or-later
export const PrivacyState = Object.freeze({
  LOCAL_ONLY_VERIFIED: 'LOCAL_ONLY_VERIFIED',
  EXTERNAL_METADATA_ONLY: 'EXTERNAL_METADATA_ONLY',
  EXTERNAL_CONNECTOR_ACTIVE: 'EXTERNAL_CONNECTOR_ACTIVE',
  REMOTE_MODEL_ACTIVE: 'REMOTE_MODEL_ACTIVE',
  POLICY_VIOLATION_BLOCKED: 'POLICY_VIOLATION_BLOCKED',
});

export function privacyBanner(state) {
  if (state === PrivacyState.LOCAL_ONLY_VERIFIED) {
    return {
      headline: 'NOESAR runs locally on your device.',
      detail: 'No data is sent to external servers.',
      verified: true,
      external: false,
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
    return { state: PrivacyState.EXTERNAL_METADATA_ONLY, allowed: false, requiresApproval: true, data: ['product version', 'platform', 'update channel'] };
  }
  if (kind === 'remote-model') {
    return { state: PrivacyState.REMOTE_MODEL_ACTIVE, allowed: false, requiresApproval: true, data: request.data ?? ['prompt'] };
  }
  if (kind === 'connector') {
    return { state: PrivacyState.EXTERNAL_CONNECTOR_ACTIVE, allowed: false, requiresApproval: true, data: request.data ?? [] };
  }
  return { state: PrivacyState.POLICY_VIOLATION_BLOCKED, allowed: false, reason: 'Unknown egress type' };
}
