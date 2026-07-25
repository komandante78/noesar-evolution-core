# Data Plane Migration Target

The executable V0.2.0 reference runtime uses an atomic local auth store to keep
this package dependency-free. The final authority must implement the same
contracts on PostgreSQL and execute migrations transactionally.

`database/postgres/0001_identity_and_sessions.sql` is a target schema, not an
executed production migration in this gate.
