BEGIN;

ALTER TABLE noesar_workspaces ENABLE ROW LEVEL SECURITY;
ALTER TABLE noesar_projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE noesar_project_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE noesar_audit_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE noesar_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE noesar_memory_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY noesar_workspace_member_read ON noesar_workspaces
  FOR SELECT
  USING (
    id::text = current_setting('noesar.workspace_id', true)
  );

CREATE POLICY noesar_project_member_read ON noesar_projects
  FOR SELECT
  USING (
    workspace_id::text = current_setting('noesar.workspace_id', true)
  );

CREATE POLICY noesar_document_project_scope ON noesar_documents
  USING (
    workspace_id::text = current_setting('noesar.workspace_id', true)
    AND (
      project_id IS NULL
      OR project_id::text = current_setting('noesar.project_id', true)
    )
  );

CREATE POLICY noesar_memory_project_scope ON noesar_memory_items
  USING (
    workspace_id::text = current_setting('noesar.workspace_id', true)
    AND (
      project_id IS NULL
      OR project_id::text = current_setting('noesar.project_id', true)
    )
  );

COMMIT;
