# Enterprise Scale-Out

Enterprise may externalize PostgreSQL, Qdrant, S3 storage, KMS/HSM, identity,
observability and model-runtime nodes. The Security Kernel remains authority;
remote workers use workload identities and bounded tokens.

Required controls include HA, tenant isolation, RTO/RPO, backup tests,
federation policy, segmentation, certificate rotation, capacity planning,
rolling upgrade and failure-domain awareness.
