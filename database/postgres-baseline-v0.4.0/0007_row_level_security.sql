-- SPDX-License-Identifier: AGPL-3.0-or-later
BEGIN;

ALTER TABLE noesar_core.workspaces ENABLE ROW LEVEL SECURITY;
ALTER TABLE noesar_core.projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE noesar_core.project_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE noesar_audit.events ENABLE ROW LEVEL SECURITY;
ALTER TABLE noesar_knowledge.documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE noesar_knowledge.memory_items ENABLE ROW LEVEL SECURITY;

ALTER TABLE noesar_core.workspaces FORCE ROW LEVEL SECURITY;
ALTER TABLE noesar_core.projects FORCE ROW LEVEL SECURITY;
ALTER TABLE noesar_core.project_members FORCE ROW LEVEL SECURITY;
ALTER TABLE noesar_audit.events FORCE ROW LEVEL SECURITY;
ALTER TABLE noesar_knowledge.documents FORCE ROW LEVEL SECURITY;
ALTER TABLE noesar_knowledge.memory_items FORCE ROW LEVEL SECURITY;

CREATE POLICY noesar_workspace_scope
ON noesar_core.workspaces
USING (
  id::text = current_setting('noesar.workspace_id', true)
);

CREATE POLICY noesar_project_scope
ON noesar_core.projects
USING (
  workspace_id::text = current_setting('noesar.workspace_id', true)
  AND (
    current_setting('noesar.project_id', true) = ''
    OR id::text = current_setting('noesar.project_id', true)
  )
);

CREATE POLICY noesar_project_members_scope
ON noesar_core.project_members
USING (
  project_id::text = current_setting('noesar.project_id', true)
);

CREATE POLICY noesar_audit_scope
ON noesar_audit.events
FOR SELECT
USING (
  workspace_id::text = current_setting('noesar.workspace_id', true)
  AND (
    project_id IS NULL
    OR project_id::text = current_setting('noesar.project_id', true)
  )
);

CREATE POLICY noesar_document_scope
ON noesar_knowledge.documents
USING (
  workspace_id::text = current_setting('noesar.workspace_id', true)
  AND (
    project_id IS NULL
    OR project_id::text = current_setting('noesar.project_id', true)
  )
)
WITH CHECK (
  workspace_id::text = current_setting('noesar.workspace_id', true)
  AND (
    project_id IS NULL
    OR project_id::text = current_setting('noesar.project_id', true)
  )
);

CREATE POLICY noesar_memory_scope
ON noesar_knowledge.memory_items
USING (
  workspace_id::text = current_setting('noesar.workspace_id', true)
  AND (
    project_id IS NULL
    OR project_id::text = current_setting('noesar.project_id', true)
  )
)
WITH CHECK (
  workspace_id::text = current_setting('noesar.workspace_id', true)
  AND (
    project_id IS NULL
    OR project_id::text = current_setting('noesar.project_id', true)
  )
);

COMMIT;
