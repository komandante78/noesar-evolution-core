# Capability Production Evidence Chain

Production authorization requires exact hashes for:

- capability package;
- policy decision;
- Rust authority attestation V3;
- PostgreSQL data-plane attestation V3;
- sandbox attestation V3;
- runtime readiness report.

The sandbox attestation independently repeats these hashes. The verifier rejects
any disagreement between the outer evidence record and sandbox evidence.
