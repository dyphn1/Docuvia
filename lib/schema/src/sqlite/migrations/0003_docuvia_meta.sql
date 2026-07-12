-- 0003_docuvia_meta.sql
-- STOR-002: small key/value store, currently used to remember the knowledge-branch tip sha
-- local.db was last hydrated from, so read commands can cheaply detect staleness without
-- re-parsing JSONL on every call. Disposable like the rest of local.db — Git remains the source
-- of truth this is rebuilt from.

CREATE TABLE IF NOT EXISTS docuvia_meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
