# PostgreSQL Repository Adapter V0.4.0

The dependency-injected adapter:

- opens an explicit transaction;
- sets actor, workspace and project context with parameterized `set_config`;
- performs only parameterized queries;
- commits on success;
- rolls back on failure;
- releases clients in all paths;
- exposes health, audit append, document list and memory insert operations.

It is tested using a deterministic fake driver. No live PostgreSQL execution is
claimed.
