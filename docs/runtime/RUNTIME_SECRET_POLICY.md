# Runtime Secret Policy

Sensitive local files include:

- `config/first-owner-setup.token`
- `config/auth-master.key`
- `state/auth.json`
- future license and signing trust material

They must be mode `0600`, excluded from diagnostic bundles and protected by
workspace backup policy.

The foundation stores the local authentication master key in the workspace.
Final Enterprise releases should support OS keystore, TPM, HSM or external
secret-broker integration.
