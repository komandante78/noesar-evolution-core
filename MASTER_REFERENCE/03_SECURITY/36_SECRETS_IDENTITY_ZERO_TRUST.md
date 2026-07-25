# Secrets, Identity and Zero Trust

Secrets live in an encrypted vault or KMS/HSM. Workloads receive short-lived
references or scoped credentials, never global raw secrets. Secrets must not
enter prompts, model context, logs, diagnostics, audit payloads or manifests.

Trust is evaluated per identity, device, workload, resource and operation;
local network presence is not trust. Sessions use short-lived tokens, rotation,
revocation, risk-based re-authentication, secure cookies, inactivity and
absolute timeouts, with Owner step-up authentication.
