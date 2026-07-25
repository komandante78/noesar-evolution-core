-- SPDX-License-Identifier: AGPL-3.0-or-later
--
-- Multi-user identity.
--
-- Migration 0002 shipped a users table whose role CHECK admits exactly four values and
-- which has no lifecycle state at all: an account could be created but never disabled,
-- and there was no way to express a non-interactive principal. This migration widens the
-- role vocabulary to the six the product now defines, adds the lifecycle columns that
-- disabling and revoking require, and adds the two tables that let an administrator
-- create accounts without ever choosing another person's password.
BEGIN;

-- Six roles. The four inherited names keep their meaning; the two new ones are:
--   client_restricted  an interactive account with read-mostly access and no ability to
--                      manage providers, agents, tools or other users
--   service_account    a non-interactive principal that authenticates with a bearer
--                      token only. It has no password and no TOTP by construction, so
--                      the MFA requirement below deliberately does not apply to it.
ALTER TABLE noesar_identity.users
  DROP CONSTRAINT IF EXISTS users_role_check;
ALTER TABLE noesar_identity.users
  ADD CONSTRAINT users_role_check CHECK (
    role IN ('owner','admin','developer','user','client_restricted','service_account')
  );

ALTER TABLE noesar_identity.users
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'active',
  ADD COLUMN IF NOT EXISTS disabled_at timestamptz,
  ADD COLUMN IF NOT EXISTS disabled_reason text,
  ADD COLUMN IF NOT EXISTS created_by uuid REFERENCES noesar_identity.users(id),
  ADD COLUMN IF NOT EXISTS mfa_required boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS last_login_at timestamptz;

ALTER TABLE noesar_identity.users
  DROP CONSTRAINT IF EXISTS users_status_check;
ALTER TABLE noesar_identity.users
  ADD CONSTRAINT users_status_check CHECK (
    status IN ('active','disabled','revoked')
  );

-- A disabled or revoked account must carry the timestamp that says when. Without this,
-- "disabled" is a claim with no evidence behind it and the audit trail cannot be
-- reconstructed from the data alone.
ALTER TABLE noesar_identity.users
  DROP CONSTRAINT IF EXISTS users_disabled_at_present;
ALTER TABLE noesar_identity.users
  ADD CONSTRAINT users_disabled_at_present CHECK (
    (status = 'active' AND disabled_at IS NULL)
    OR (status <> 'active' AND disabled_at IS NOT NULL)
  );

-- Owner and admin must carry MFA. Enforced in the database as well as in the runtime,
-- because a check that lives only in application code is a check that a future code path
-- can forget to make.
ALTER TABLE noesar_identity.users
  DROP CONSTRAINT IF EXISTS users_privileged_roles_require_mfa;
ALTER TABLE noesar_identity.users
  ADD CONSTRAINT users_privileged_roles_require_mfa CHECK (
    role NOT IN ('owner','admin') OR mfa_required
  );

CREATE INDEX IF NOT EXISTS noesar_users_role_idx ON noesar_identity.users(role);
CREATE INDEX IF NOT EXISTS noesar_users_status_idx ON noesar_identity.users(status);

-- Workspace membership. Migration 0003 shipped project_members but no workspace-level
-- equivalent, so there was no way to say "this person belongs here" above project
-- granularity — and therefore no way for RLS to answer it either.
CREATE TABLE IF NOT EXISTS noesar_core.workspace_members (
  workspace_id uuid NOT NULL
    REFERENCES noesar_core.workspaces(id) ON DELETE CASCADE,
  user_id uuid NOT NULL
    REFERENCES noesar_identity.users(id) ON DELETE CASCADE,
  role text NOT NULL CHECK (
    role IN ('owner','admin','developer','user','client_restricted','service_account')
  ),
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES noesar_identity.users(id),
  PRIMARY KEY (workspace_id, user_id)
);

CREATE INDEX IF NOT EXISTS noesar_workspace_members_user_idx
  ON noesar_core.workspace_members(user_id);

ALTER TABLE noesar_core.project_members
  DROP CONSTRAINT IF EXISTS project_members_role_check;
ALTER TABLE noesar_core.project_members
  ADD CONSTRAINT project_members_role_check CHECK (
    role IN ('owner','admin','developer','user','client_restricted','service_account')
  );

-- Invitations. An administrator creates the account and the person who will use it
-- chooses their own password: the alternative, an administrator typing a password on
-- someone else's behalf, means the administrator has known that person's credential.
CREATE TABLE IF NOT EXISTS noesar_identity.user_invitations (
  id uuid PRIMARY KEY,
  username text NOT NULL CHECK (username = lower(username)),
  display_name text NOT NULL,
  role text NOT NULL CHECK (
    role IN ('owner','admin','developer','user','client_restricted','service_account')
  ),
  token_digest bytea NOT NULL UNIQUE,
  invited_by uuid NOT NULL REFERENCES noesar_identity.users(id),
  workspace_id uuid REFERENCES noesar_core.workspaces(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  accepted_at timestamptz,
  accepted_user_id uuid REFERENCES noesar_identity.users(id),
  revoked_at timestamptz,
  CHECK (accepted_at IS NULL OR revoked_at IS NULL)
);

CREATE INDEX IF NOT EXISTS noesar_user_invitations_open_idx
  ON noesar_identity.user_invitations(expires_at)
  WHERE accepted_at IS NULL AND revoked_at IS NULL;

-- Service account credentials. Only the digest is stored: a token this table could
-- return in cleartext would be a token an operator could read out of a backup.
CREATE TABLE IF NOT EXISTS noesar_identity.service_account_tokens (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES noesar_identity.users(id) ON DELETE CASCADE,
  name text NOT NULL,
  token_digest bytea NOT NULL UNIQUE,
  created_by uuid NOT NULL REFERENCES noesar_identity.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz,
  last_used_at timestamptz,
  revoked_at timestamptz
);

CREATE INDEX IF NOT EXISTS noesar_service_account_tokens_user_idx
  ON noesar_identity.service_account_tokens(user_id);

COMMIT;
