# Audit Hash Chain V0.6.0

Before each audit insert, PostgreSQL:

- validates lowercase SHA-256 values;
- acquires a per-workspace advisory transaction lock;
- reads the latest workspace event hash;
- requires the all-zero genesis hash for the first event;
- rejects discontinuity;
- retains existing update/delete immutability.

Runtime concurrency and corruption tests remain `NOT_EXECUTED`.
