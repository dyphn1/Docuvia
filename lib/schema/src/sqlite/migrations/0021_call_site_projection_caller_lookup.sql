-- Edge-scoped impact reads start from the projected caller and then filter by target.
CREATE INDEX IF NOT EXISTS call_site_resolution_projection_callers_node_idx
  ON call_site_resolution_projection_callers(project_id, caller_node_key, call_site_key);

CREATE INDEX IF NOT EXISTS call_site_resolutions_project_target_idx
  ON call_site_resolutions(project_id, selected_target_node_key, call_site_key);
