
# Single external container architecture

The primary deployment target is one externally visible OCI container. Internal process separation may be used, but Docker-in-Docker, nested containers and mandatory Compose are not required. Runtime data and customer content remain local by default.

The final deployment image remains unvalidated because the OS-level sandbox policy referenced by deployment scripts is still an open B003 work package.
