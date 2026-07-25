# Authenticated Capability Lifecycle

Every lifecycle operation receives an identity context created by the
authenticated NOESAR control plane.

```text
actor ID
role
session ID
organization
project
strong-reauthentication state
```

The reference manager does not accept a Boolean `owner_mode`.

Approvals are bound to actor, role, session, organization, project, package,
plan and expiry. Approval nonces are single-use and replay attempts are denied.
