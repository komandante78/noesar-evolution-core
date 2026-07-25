# Supply Chain and Update Security

Each release carries digest, signature, TUF-style metadata, SLSA provenance,
CycloneDX SBOM, model ML-BOM, cryptographic inventory where needed, VEX,
license report and reproducible-build evidence.

Update flow: retrieve signed metadata; verify root/delegation/expiry/version;
reject rollback/freeze/mix-and-match; download bounded artifact; verify
signature/digest/provenance; analyze compatibility and permission diff;
quarantine; test; request authorization; backup; activate; verify; retain
rollback. Root keys remain offline, online keys are delegated/scoped, and
critical releases use threshold signing.
