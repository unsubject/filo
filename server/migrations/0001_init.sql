-- filo — initial schema (spec §5.2)
-- All timestamps are INTEGER epoch-milliseconds.

CREATE TABLE documents (
  id            TEXT PRIMARY KEY,
  title         TEXT NOT NULL,
  status        TEXT NOT NULL DEFAULT 'draft'
                  CHECK (status IN ('draft', 'sealed')),
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL,
  sealed_at     INTEGER            -- last successful seal, null if never sealed
);

CREATE TABLE lines (
  id                        TEXT PRIMARY KEY,
  document_id               TEXT NOT NULL
                              REFERENCES documents(id) ON DELETE CASCADE,
  client_line_id            TEXT NOT NULL,  -- client-generated, for idempotency
  seq                       INTEGER NOT NULL, -- server-assigned, monotonic per doc
  raw_text                  TEXT NOT NULL,  -- exactly as typed; never overwritten
                                            -- (empty string for a blank line)
  corrected_text            TEXT,           -- silent fix; null until corrected
  correction_status         TEXT NOT NULL DEFAULT 'pending'
                              CHECK (correction_status IN
                                ('pending','corrected','unchanged','failed','skipped')),
  correction_model          TEXT,
  correction_prompt_version TEXT,
  correction_error          TEXT,
  corrected_at              INTEGER,
  deleted_at                INTEGER,        -- soft-delete tombstone
  created_at                INTEGER NOT NULL,
  UNIQUE (document_id, seq),
  UNIQUE (document_id, client_line_id)
);

CREATE TABLE seals (
  id                 TEXT PRIMARY KEY,
  document_id        TEXT NOT NULL
                       REFERENCES documents(id) ON DELETE CASCADE,
  formatted_markdown TEXT NOT NULL,
  model              TEXT NOT NULL,
  prompt_version     TEXT,
  created_at         INTEGER NOT NULL        -- newest row = current export
);

CREATE INDEX idx_lines_doc_seq     ON lines(document_id, seq);
CREATE INDEX idx_lines_doc_pending ON lines(document_id, correction_status, deleted_at);
CREATE INDEX idx_seals_doc_created ON seals(document_id, created_at);
