CREATE SCHEMA IF NOT EXISTS chief_lifecycle;
CREATE TABLE IF NOT EXISTS chief_lifecycle.schema_version (
  version INT4 PRIMARY KEY, checksum TEXT NOT NULL, applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS chief_lifecycle.member_session (
  id UUID PRIMARY KEY, workspace UUID NOT NULL, account UUID NOT NULL,
  person TEXT NOT NULL, secret_hash TEXT UNIQUE NOT NULL, credential TEXT NOT NULL,
  generation INT4 NOT NULL DEFAULT 1, expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ, UNIQUE (workspace, account, id)
);
CREATE TABLE IF NOT EXISTS chief_lifecycle.connection_challenge (
  id UUID PRIMARY KEY, workspace UUID NOT NULL, account UUID NOT NULL,
  session_id UUID NOT NULL, session_generation INT4 NOT NULL,
  code_hash TEXT UNIQUE NOT NULL, expires_at TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ,
  FOREIGN KEY (workspace, account, session_id)
    REFERENCES chief_lifecycle.member_session (workspace, account, id)
);
CREATE TABLE IF NOT EXISTS chief_lifecycle.member_connection (
  id UUID PRIMARY KEY, workspace UUID NOT NULL, account UUID NOT NULL,
  session_id UUID NOT NULL, session_generation INT4 NOT NULL,
  runtime_id UUID NOT NULL, public_key TEXT NOT NULL, capability_hash TEXT UNIQUE NOT NULL,
  bots JSONB NOT NULL, scopes JSONB NOT NULL, state TEXT NOT NULL,
  generation INT4 NOT NULL DEFAULT 1, created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL, revoked_at TIMESTAMPTZ,
  CHECK (state IN ('pending', 'active', 'revoked')),
  FOREIGN KEY (workspace, account, session_id)
    REFERENCES chief_lifecycle.member_session (workspace, account, id),
  UNIQUE (workspace, account, id)
);
CREATE INDEX IF NOT EXISTS connection_by_member
  ON chief_lifecycle.member_connection (workspace, account, session_id);
CREATE TABLE IF NOT EXISTS chief_lifecycle.runtime_nonce (
  connection_id UUID NOT NULL REFERENCES chief_lifecycle.member_connection (id),
  nonce_hash TEXT NOT NULL, expires_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (connection_id, nonce_hash)
);
