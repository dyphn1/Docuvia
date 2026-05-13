-- Suggested SQL DDL for adding l3_node_source_refs table
-- Coordinate with Database Schema Expert to convert into a Drizzle migration

CREATE TABLE IF NOT EXISTS l3_node_source_refs (
  id serial PRIMARY KEY,
  l3_node_id integer NOT NULL REFERENCES l3_nodes(id) ON DELETE CASCADE,
  source_type text NOT NULL,
  source_path text,
  source_id integer,
  created_at timestamp NOT NULL DEFAULT now()
);

-- Useful unique constraint to avoid duplicates (adjust as needed)
CREATE UNIQUE INDEX IF NOT EXISTS idx_l3_node_source_unique ON l3_node_source_refs (l3_node_id, source_type, source_path);

-- Optional index for fast lookup by source_path
CREATE INDEX IF NOT EXISTS idx_l3_node_source_path ON l3_node_source_refs USING btree (source_path);

-- Notes for Database Schema Expert:
-- - Use Drizzle's migration tooling to add a migration file that performs the CREATE TABLE + INDEX statements.
-- - Consider adding `source_metadata jsonb` column if structured metadata is needed in future.
-- - Ensure this migration runs after the migration that created `l3_nodes`.
