BEGIN;

CREATE TABLE IF NOT EXISTS noesar_publishers (
  id text PRIMARY KEY,
  trust_level text NOT NULL CHECK (
    trust_level IN ('noesar-official','certified-partner','customer-private','community')
  ),
  public_key_pem text NOT NULL,
  fingerprint_sha256 text NOT NULL UNIQUE CHECK (length(fingerprint_sha256) = 64),
  status text NOT NULL CHECK (status IN ('active','revoked')),
  registered_by uuid NOT NULL REFERENCES noesar_users(id),
  registered_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz
);

CREATE TABLE IF NOT EXISTS noesar_capabilities (
  id text NOT NULL,
  version text NOT NULL,
  publisher_id text NOT NULL REFERENCES noesar_publishers(id),
  package_sha256 text NOT NULL CHECK (length(package_sha256) = 64),
  manifest jsonb NOT NULL,
  state text NOT NULL CHECK (
    state IN ('quarantined','active','disabled','uninstalled','revoked')
  ),
  organization_id text NOT NULL DEFAULT 'local',
  project_id uuid REFERENCES noesar_projects(id),
  installed_by uuid NOT NULL REFERENCES noesar_users(id),
  installed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id, version)
);

CREATE TABLE IF NOT EXISTS noesar_capability_approvals (
  nonce text PRIMARY KEY,
  capability_id text NOT NULL,
  capability_version text NOT NULL,
  actor_user_id uuid NOT NULL REFERENCES noesar_users(id),
  session_id uuid NOT NULL REFERENCES noesar_sessions(id),
  plan_hash text NOT NULL CHECK (length(plan_hash) = 64),
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  FOREIGN KEY (capability_id, capability_version)
    REFERENCES noesar_capabilities(id, version)
);

COMMIT;
