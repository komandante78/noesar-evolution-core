-- SPDX-License-Identifier: AGPL-3.0-or-later
BEGIN;
CREATE SCHEMA IF NOT EXISTS noesar_identity;

CREATE TABLE IF NOT EXISTS noesar_identity.users (
  id uuid PRIMARY KEY,
  username text NOT NULL UNIQUE CHECK (username = lower(username)),
  display_name text NOT NULL,
  role text NOT NULL CHECK (role IN ('owner','admin','developer','user')),
  password_scheme text NOT NULL,
  password_salt bytea NOT NULL,
  password_hash bytea NOT NULL,
  password_parameters jsonb NOT NULL,
  totp_envelope jsonb,
  failed_login_count integer NOT NULL DEFAULT 0,
  locked_until timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS noesar_identity.sessions (
  id uuid PRIMARY KEY,
  token_digest bytea NOT NULL UNIQUE,
  csrf_digest bytea NOT NULL,
  user_id uuid NOT NULL REFERENCES noesar_identity.users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL,
  last_seen_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  idle_expires_at timestamptz NOT NULL,
  elevated_until timestamptz,
  revoked_at timestamptz
);

CREATE INDEX IF NOT EXISTS sessions_user_id_idx ON noesar_identity.sessions(user_id);
CREATE INDEX IF NOT EXISTS sessions_expiry_idx ON noesar_identity.sessions(expires_at);
COMMIT;
