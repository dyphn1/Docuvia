CREATE TYPE integration_type AS ENUM ('slack', 'teams');

CREATE TABLE project_integrations (
  id SERIAL PRIMARY KEY,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  integration_type integration_type NOT NULL,
  webhook_url TEXT NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT true,
  notification_types JSONB DEFAULT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_project_integrations_project ON project_integrations(project_id);
