# Data and Storage Architecture

PostgreSQL is authoritative for identity, projects, documents, tasks,
workflows, permissions, licensing, models, modules, audit index, memory metadata,
knowledge edges and retention. Baseline is PostgreSQL 18 or the supported stable
release approved at freeze.

pgvector is default vector search. Qdrant is optional for distributed or large
hybrid retrieval. DuckDB handles local CSV/Parquet/scientific analytics and is
not the multiuser authority. Objects use encrypted content-addressed storage;
optional Enterprise adapters support S3/MinIO. Typed graph edges remain
canonical in PostgreSQL.
