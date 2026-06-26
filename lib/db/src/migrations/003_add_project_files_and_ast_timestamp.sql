-- Migration: Add project_files table and last_ast_ingested_at column
-- Supports Sub-second Incremental Watch (Phase 8)
-- Created: 2026-06-26

-- 1. Add last_ast_ingested_at column to projects table (if not exists)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'projects' AND column_name = 'last_ast_ingested_at'
  ) THEN
    ALTER TABLE projects ADD COLUMN last_ast_ingested_at timestamp;
  END IF;
END $$;

-- 2. Create project_files table for incremental AST change detection
CREATE TABLE IF NOT EXISTS project_files (
  id SERIAL PRIMARY KEY,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  file_path TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  last_parsed_at TIMESTAMP NOT NULL DEFAULT NOW(),
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- 3. Indexes for project_files
CREATE INDEX IF NOT EXISTS idx_project_file_project_path ON project_files (project_id, file_path);
CREATE INDEX IF NOT EXISTS idx_project_files_project ON project_files (project_id);
