# Multi-user security model

**Status:** `MULTI_USER_RUNTIME=PASS` · `ROW_LEVEL_SECURITY=PASS` · `PROJECT_USER_ISOLATION=PASS`
**Closes:** Phase 4 finding **F4-008** and the `multi-user is unsupported` entry in the
Phase 4 handoff.

---

## What Phase 4 found, and why it could not be fixed there

F4-008 was blunt: the security matrix claimed user and project isolation was
`IMPLEMENTED`, and the data plane stored **no per-user ownership at all** — not on
projects, conversations, memories, artifacts or sources. No route created a second user.
`auth.manage` was granted to owner and admin and wired to nothing.

So isolation could not be enforced, because there was nothing to enforce it against. The
Phase 4 report said so and stopped, which was correct. This is the work that follows.

## The six roles

| Role | Interactive | MFA | May administer accounts | Notes |
|---|---|---|---|---|
| `owner` | yes | required | all roles | holds `coden.owner-bypass`; the last active one cannot be removed |
| `admin` | yes | required | developer and below | may **not** create or modify an owner or another admin |
| `developer` | yes | enrolled | no | full workspace and capability management |
| `user` | yes | enrolled | no | workspace read/write, memory, artifacts, knowledge |
| `client_restricted` | yes | enrolled | no | converse and read; no provider, agent, tool or shared-memory management |
| `service_account` | **no** | n/a | no | bearer token only; no password, no TOTP; read and provider use |

Permission sets live in one place, `ROLE_PERMISSIONS` in `src/auth.mjs`, and narrow
monotonically. `client_restricted` deliberately lacks every capability that would let one
account change what another account's session executes: `provider.manage`, `agent.manage`,
`memory.manage`.

### MFA is universal for interactive accounts

The requirement names owner and admin as a floor. The implementation goes further, and
the reason is a defect rather than a preference.

`AuthService.completeLogin()` decrypts `user.totp` unconditionally. Until multi-user
existed there was exactly one account and it always had a secret, so the assumption held.
An account created without one **could never log in at all** — the invitation flow would
have shipped accounts that cannot authenticate. Found by end-to-end testing against a live
server, not by any unit test.

Of the two ways out, this is the safer one. The alternative adds a branch to the login
path that issues a session after the password step alone, and a code path that can skip a
factor is a code path that can be reached by mistake. So every interactive account enrols
MFA before it exists. Service accounts are unaffected: they authenticate with a token and
never reach that path.

Defence in depth: `completeLogin` now refuses an account with no TOTP envelope explicitly
(403, audited) rather than dereferencing null and answering 500.

Recorded as finding **F4C-004**.

## Account lifecycle

### Invitation, not password-setting

An administrator creates the account; the person who will use it chooses their own
password. The alternative — an administrator typing a password on someone else's behalf —
means the administrator has known that person's credential.

```text
POST /api/v1/admin/invitations        (user.manage)  -> token, shown exactly once
POST /api/v1/auth/invitation/accept   (token)        -> password chosen here, MFA enrolment begins
POST /api/v1/auth/invitation/confirm  (TOTP)         -> account created, session established
```

Only the token's **digest** is stored, so an operator reading `state/auth.json` — or a
backup of it — cannot replay an invitation. The token has a 72-hour TTL.

A privileged account does not exist until MFA is enrolled. Creating it first and asking
for MFA afterwards would leave a window in which it has a single factor.

**The invitation is consumed when it is claimed, not when enrolment completes.** Otherwise
the token stays live for the whole enrolment window and can start a second, parallel
enrolment with a different password, with the last confirmation winning. The claim lapses
with the enrolment window, so a fumbled authenticator setup is recoverable rather than
locking the invitation permanently. Recorded as finding **F4C-005**.

### Privilege containment

* An administrator may not grant `owner` or `admin`. Privilege escalation by self-service
  is the failure mode this closes, and it costs nothing because the owner can still do it.
* An administrator may not disable, erase or re-role an owner or another administrator.
* The last **active** owner cannot be demoted, disabled, revoked or erased.
* No account can disable, revoke or erase itself — that is how an installation ends up
  with nobody who can administer it.
* Promotion into a role that requires MFA is refused if the account has no TOTP secret,
  which since universal enrolment means the only candidate is a service account. Promoting
  one would create a privileged principal authenticating with a bearer token and nothing
  else.

### Disable, revoke, erase

| Action | Effect | Reversible |
|---|---|---|
| disable | status `disabled`, **all live sessions dropped**, all service tokens revoked | yes |
| revoke | status `revoked`, same effects | no |
| erase | anonymised in place: username replaced, display name cleared, password and TOTP destroyed, sessions and tokens deleted | no |

Disabling takes effect on **live sessions**, not only on the next login. It is enforced on
the authentication path that every request passes through, rather than at revocation time
where a missed session would survive until its cookie expired.

A disabled, revoked or non-interactive account fails login down the **same branch, with
the same message and the same timing** as a wrong password. Answering "that account is
disabled" would turn the login form into an account-status oracle for anyone who can guess
a username.

Erasure anonymises rather than deleting, because audit events reference the actor by id
and a dangling reference silently breaks the ledger's readability. What is destroyed is
everything identifying the person and everything that could authenticate as them.

## Isolation

### Where identity lives

Two stores, deliberately:

* **Credentials** — password verifier, encrypted TOTP envelope, replay high-water mark —
  stay in the auth store (`state/auth.json`, mode 0600). They are **not** moved into
  PostgreSQL. The database is dumped for backup and restored into probe databases, and a
  dump that cannot contain a password verifier is a dump that cannot leak one. This
  narrows what Phase 4 finding F4-013 (unencrypted workspace backup) is about.
* **Identity facts the data plane must join against** — id, username, role, status — are
  projected into `noesar_identity.users` so RLS has a subject to reason about. The
  projection carries no credential material: `password_scheme` is `external-auth-store`
  and the salt and hash columns hold a single zero byte.

The projection is written on an administrative connection, because RLS on
`noesar_identity.users` restricts every row to the acting user and a projection by
definition acts for all of them.

### The RLS mechanism

Migration 0007 scoped rows by workspace and project. That is **tenancy**, not user
isolation: two people in the same workspace saw each other's documents and memories.

PostgreSQL combines several **permissive** policies with `OR`, so adding a second
permissive policy *widens* access. The per-user rules are therefore declared
**`AS RESTRICTIVE`**, which combines with `AND`: the inherited tenancy policy still has to
pass, and the ownership rule has to pass as well. Nothing 0007 allowed becomes more
permissive; everything it allowed becomes narrower.

Every isolated resource carries the same three fields, so one policy shape covers all of
them and a new resource class cannot quietly be given a weaker rule:

```text
workspace_id    tenancy
owner_user_id   the principal the row belongs to
visibility      private | project | workspace
```

Read is allowed when the actor owns the row, or the row is `project`-visible and the actor
is a project member, or it is `workspace`-visible and the actor is a workspace member.
**Write is narrower than read**: only the owner may change a row, even one shared for
reading. Sharing is not delegation.

The helper functions are `SECURITY DEFINER` because a membership lookup made by a policy on
a table that itself has RLS would recurse. That is safe here for three specific reasons,
each of which is the usual way `SECURITY DEFINER` goes wrong: they take typed `uuid`
arguments and build no dynamic SQL; `search_path` is pinned; and `EXECUTE` is revoked from
`PUBLIC` and granted only to the application role.

### Covered resource classes

`conversations`, `conversation_messages`, `files`, `artifacts`, `agents`, `tools`,
`vector_entries`, `documents`, `memory_items`, `projects`, `workspaces`,
`workspace_members`, `project_members`, `users`, `events` — 15 tables with
`ENABLE` **and** `FORCE ROW LEVEL SECURITY`.

The per-user vector store (`noesar_knowledge.vector_entries`) is separate from the memory
promotion pipeline because it is the surface a search actually reads, and the surface where
a cross-user leak would be invisible in the UI. `DB-38` asserts that a vector search
returns **zero** rows belonging to another user's private entries — not that it ranks them
lower.

### Administrators do not read user content

Account administration is a privileged runtime operation with its own permission check and
its own audit record. It does **not** grant a blanket `SELECT` over the identity table or
over anyone's conversations. An administrator can disable an account; they cannot read its
chats through the data plane. This is a deliberate design choice, recorded here because a
reader may expect the opposite.

## Audit

Every administrative action is recorded twice: in the hash-chained
`noesar_audit.events` ledger, and in `noesar_identity.administrative_events`, which
answers "who changed whose role, and when" without requiring a chain walk.

### A defect in the delivered RLS

Migration 0007 enabled RLS on `noesar_audit.events` and gave it a policy `FOR SELECT`
only. With `FORCE ROW LEVEL SECURITY` and no INSERT policy, **every append was denied** —
so `PostgresRepository.appendAuditEvent()` could never have written a row. Migration 0015
adds the INSERT policy; `UPDATE` and `DELETE` remain unreachable, which is what the
immutability trigger is for. Verified by `DB-41` (append succeeds) and `DB-42` (delete
refused). Recorded as **F4C-003**.

## Evidence

| Suite | Result |
|---|---|
| `test/user-directory.test.mjs` | **29/29 PASS** |
| `tools/acceptance/multi-user-isolation.mjs` — live, four accounts, three roles | **29/29 PASS** |
| `tools/acceptance/postgres-integration.mjs` RLS section (`DB-19`…`DB-24`, `DB-34`…`DB-44`) | **PASS** |

The live suite bootstraps an Owner, invites an Admin and two ordinary users, completes a
real password + TOTP login for one of them, and then exercises privilege containment,
service accounts, disable/reinstate, export and erasure across separately authenticated
sessions.

The database-level isolation tests put **user C in the same workspace and the same project
as user A** — the case tenancy scoping alone cannot handle — and assert that A cannot see
C's private document, can see C's project-shared one, cannot modify it, and never receives
C's private vector entry from a search.

## Limits, stated

* **The Owner bootstrap on the real installation has not been performed.** By design; see
  `OWNER_BOOTSTRAP.md`. Everything above was verified on a probe installation with the same
  image, and on the installed instance for everything that does not require an account.
* **No password rotation or expiry policy**, and no account-recovery flow other than an
  administrator issuing a new invitation.
* **Session fixation across role change** is not re-checked: changing a user's role does
  not drop their existing sessions, so a demotion takes effect on the next permission check
  rather than immediately. Permissions are read from the live user record on every request,
  so the demotion *is* enforced — but the session itself survives.
* **No independent penetration test.** The same party wrote the implementation, the tests
  and this document.
