# Versioned context graph and transparent memory

A conversation branch points to a head message. Every message records zero or more parents. Revisions and regenerations create new nodes; they do not overwrite history. Fork creates another branch head, merge creates a two-parent system node, exclusion removes a node only from a selected branch context and undo moves a branch head to its first parent.

The context inspector reports project, branch, provider, model, included message IDs, memory IDs, source IDs, tool IDs and a token estimate before model execution.

Memory scopes are:

- global;
- project;
- conversation.

Entries are visible, editable, hideable, exportable and deletable. Project purge removes state and stored binary source blobs. Retention is configurable from 1 to 3,650 days and can be applied explicitly.
