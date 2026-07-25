
# Installation and rollback

Use the platform-specific scripts under `RUNTIME_SOURCE/deployment/`. Before mutation:

1. capture the current version, configuration and data backup;
2. verify package checksums;
3. review requested paths, ports and permissions;
4. install into a versioned path;
5. run health/readiness checks;
6. retain the prior version until acceptance passes;
7. roll back by restoring the previous version and configuration.

The supplied scripts are engineering artifacts and require real-target B004 validation before production rollout.
