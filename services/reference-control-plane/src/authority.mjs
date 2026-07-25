// SPDX-License-Identifier: AGPL-3.0-or-later

export const AuthorityMode = Object.freeze({
  REFERENCE_NODE: 'reference-node',
  RUST_EXTERNAL: 'rust-external',
});

export function authorityStatus(env = process.env) {
  const releaseChannel = String(env.NOESAR_RELEASE_CHANNEL ?? 'development').toLowerCase();
  const mode = String(env.NOESAR_AUTHORITY_MODE ?? AuthorityMode.REFERENCE_NODE).toLowerCase();
  const socket = env.NOESAR_RUST_AUTHORITY_SOCKET ?? null;
  const attestation = env.NOESAR_RUST_AUTHORITY_ATTESTATION ?? null;

  const recognized = Object.values(AuthorityMode).includes(mode);
  const rustConfigured = mode === AuthorityMode.RUST_EXTERNAL && Boolean(socket) && Boolean(attestation);
  const productionReady = false;

  return {
    releaseChannel,
    mode,
    recognized,
    rustConfigured,
    socketConfigured:Boolean(socket),
    attestationConfigured:Boolean(attestation),
    canonical:false,
    productionReady,
    protocolVersion:'1.1',
    protocolReferenceImplemented:true,
    canonicalJsonImplemented:true,
    externalClientImplemented:true,
    rustDaemonSourceImplemented:true,
    unixSoPeerCredSourceImplemented:true,
    authenticatedTransportActive:false,
    serverPeerCredentialsVerified:false,
    reason:mode === AuthorityMode.REFERENCE_NODE
      ? 'Node authority is an explicitly non-production reference implementation.'
      : 'Rust authority daemon source and a fail-closed Unix client exist in V0.6.0; the daemon was not compiled or executed.',
  };
}

export function assertReferenceRuntimeAllowed(status) {
  if (!status.recognized) {
    throw new Error(`Unknown NOESAR_AUTHORITY_MODE: ${status.mode}`);
  }
  if (status.releaseChannel === 'production') {
    throw new Error(
      'Fail-closed: the Node reference control plane cannot run as a production authority.'
    );
  }
  if (status.mode !== AuthorityMode.REFERENCE_NODE) {
    throw new Error(
      'Fail-closed: rust-external mode must be served by the compiled Rust authority, not the Node reference process.'
    );
  }
  return status;
}
