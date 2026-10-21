CREATE TABLE IF NOT EXISTS chief_lifecycle.tracker_action (
  workspace UUID NOT NULL, account UUID NOT NULL, request_id UUID NOT NULL,
  input_hash TEXT NOT NULL, object_id TEXT NOT NULL, state TEXT NOT NULL,
  result JSONB, created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace, account, request_id),
  CHECK (state IN ('uncertain', 'done'))
);
