-- Durable parser facts allow a delta to rebuild the same workspace proof index as a full pass.
-- NULL means the file was not captured by a complete, current source-index generation.
ALTER TABLE project_files ADD COLUMN source_index_json TEXT;
