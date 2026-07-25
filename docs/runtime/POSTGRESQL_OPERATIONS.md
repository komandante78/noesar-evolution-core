# PostgreSQL Operations V0.4.0

The operational flow is:

```text
static migration verification
-> deterministic plan
-> explicit backup and review
-> explicit migration confirmation
-> apply ordered migrations
-> record immutable migration ledger
-> execute live acceptance
-> perform backup/restore drill
-> issue external attestation
```

The packaging environment had no PostgreSQL binaries. All live operations remain
`NOT_EXECUTED`.
