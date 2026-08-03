# SPDX-License-Identifier: AGPL-3.0-or-later
#
# NOESAR EVOLUTION — the whole product, from source, in one file.
#
# # What this replaces, and why it had to be rewritten rather than edited
#
# Until now this file built a different system from the one that ships: no PostgreSQL at all,
# `NOESAR_DATA_PLANE=reference-json`, and `node server.mjs` as the entrypoint — the shape the
# product had before `D-0040` and `D-0240`. Every change since lived in one of 77
# `oci/Dockerfile.phase4-*` overlays, each `FROM` the previous image, and none was ever folded
# back. `D-0271` named that; this is the fold.
#
# The overlay chain hit overlay2's hard limit of 128 layers — `noesar-evolution:phase4-update-
# signing-side` stands at **127** — and was rescued by flattening the image into one layer.
# Flattening severs source from artefact: after it, `docker history` shows a single 819 MB
# layer with no recorded instruction, so how PostgreSQL, pgvector, the Rust binaries and the
# supervisor got in was no longer written down anywhere except in the local Docker daemon.
# The recipe below was recovered from the last ancestor that still carries its history and is
# preserved as evidence in `oci/lineage/` — read `oci/lineage/README.md` before changing this
# file, and check any change against the live image rather than against this comment.
#
# # Build
#
#   docker build -f oci/Dockerfile -t noesar-evolution:<tag> .
#
# Needs network, for exactly one reason recorded here rather than discovered: `apt-get` must
# reach `apt.postgresql.org` for the pinned PostgreSQL and pgvector packages. The Rust stage is
# offline by construction (`--offline --locked` against `rust/vendor`, `D-0173`).
#
# # Run — this image does not boot without it, and nothing said so until now
#
#   docker run -d --read-only \
#     --tmpfs /run:rw,nosuid,nodev,noexec,mode=1777 \
#     --tmpfs /tmp:rw,nosuid,nodev,noexec \
#     -v <workspace>:/workspace \
#     noesar-evolution:<tag>
#
# The root filesystem is read-only, so `/run` and `/tmp` have to be tmpfs. **`mode=1777` on
# `/run` is load-bearing, not tidiness**: the api peer binds the unix socket
# `/run/codev-peer.sock` as uid 10001, and on a root-owned `/run` that is
# `listen EACCES: permission denied` — the api dies, the supervisor restarts it five times and
# gives up, and the container sits `running` and `unhealthy` with PostgreSQL perfectly fine.
# Measured, by booting this image without it. Only the workspace volume is writable, and it is
# where the PostgreSQL data directory lives.
#
# # Two labels the live image carries are deliberately absent
#
# `org.noesar.base-image` and `org.noesar.flatten` describe a lineage that no longer exists:
# this file has no base image but `node:22-bookworm-slim`, and nothing is flattened. Copying
# them across would re-record, on a fresh artefact, a history it does not have.

# Declared before the first `FROM`: an `ARG` used in a `FROM` has to be in the global scope,
# and this file now opens with a builder stage rather than with the runtime.
ARG NODE_IMAGE=node:22-bookworm-slim

# ------------------------------------------------------------------------------------------
# The two Rust peers. One stage, not two: `noesar-supervisord` (PID 1, ARCH-001) and
# `noesar-sandbox` were introduced by separate overlays and so were built twice from the same
# vendored tree. Nothing depended on their being separate builds.
# ------------------------------------------------------------------------------------------
FROM rust:1-bookworm AS rust-builder
ENV RUSTUP_TOOLCHAIN=1.97.1-x86_64-unknown-linux-gnu
WORKDIR /build
COPY rust/ /build/rust/
RUN cd /build/rust \
 && cargo build --offline --locked --release -p noesar-supervisor -p noesar-sandbox \
 && test -x /build/rust/target/release/noesar-supervisord \
 && test -x /build/rust/target/release/noesar-sandbox

# ------------------------------------------------------------------------------------------
# The runtime.
# ------------------------------------------------------------------------------------------
FROM ${NODE_IMAGE}

LABEL org.opencontainers.image.title="NOESAR Evolution"
LABEL org.opencontainers.image.description="V4 complete self-hosted implementation runtime"
LABEL org.opencontainers.image.licenses="AGPL-3.0-or-later"
LABEL org.opencontainers.image.version="1.0.0-ai-workspace-phase4-complete-lan"
LABEL org.noesar.release.channel="complete"
LABEL org.noesar.production-ready="pending-target-validation"
LABEL org.noesar.authority="reference-node"
LABEL org.noesar.authority-protocol="reference-hmac-v1.1"
LABEL org.noesar.data-plane="postgresql"
LABEL org.noesar.postgres-baseline="0.5.0"
LABEL org.noesar.postgresql.version="18.4-1.pgdg12+1"
LABEL org.noesar.pgvector.version="0.8.5-1.pgdg12+1"
LABEL org.noesar.exposure.default="loopback"
LABEL org.noesar.arch-001="complete-3-of-3-peers"
LABEL org.noesar.arch-005="six-adapters-audited-individually"
LABEL org.noesar.arch-008="closed-both-language-sides"
LABEL org.noesar.block-c="c6-final"
LABEL org.noesar.block-d="d3c-voice-control"
LABEL org.noesar.block-e="update-manager-channel-key-route"
LABEL org.noesar.cube-004="typed-views"
LABEL org.noesar.cube-c1="schema-only"
LABEL org.noesar.modules="debug-evolution-external-link"
LABEL org.noesar.sess-001="built"
LABEL org.noesar.sess-002="built"
LABEL org.noesar.sess-003="built"
LABEL org.noesar.phase4.remediations="F4-002 F4-004 F4-005 F4-006 F4-007 F4-008"
LABEL org.noesar.phase4.lan-remediations="F4L-001"
LABEL org.noesar.phase="4-debug-evolution-api-targets"
LABEL org.noesar.feature="api-targets-registry-and-probe-credentials-stay-in-the-vault-and-are-injected-per-probe"
LABEL org.noesar.lineage="single-file-reconciliation-of-77-overlays"

# Media and document tooling, plus the unprivileged identity everything else runs as. `10001`
# is not cosmetic: the module boundary of `D-0290` is drawn with it.
RUN apt-get update \
 && apt-get install -y --no-install-recommends unzip poppler-utils tesseract-ocr ffmpeg ca-certificates \
 && rm -rf /var/lib/apt/lists/* \
 && groupadd --gid 10001 noesar \
 && useradd --uid 10001 --gid 10001 --home-dir /nonexistent --shell /usr/sbin/nologin noesar \
 && mkdir -p /opt/noesar /workspace \
 && chown -R 10001:10001 /opt/noesar /workspace

# PostgreSQL and pgvector from apt.postgresql.org, versions pinned exactly. The signing key is
# vendored in the repository rather than fetched, so the only thing trusted at build time is a
# file under version control. `create_main_cluster = false`: this image never runs the cluster
# Debian would create for it — the data directory lives in the workspace volume and is created
# by the postgres peer at first start.
COPY oci/keys/apt.postgresql.org.asc /usr/share/postgresql-common/pgdg/apt.postgresql.org.asc
RUN set -eux; \
    install -d -m 0755 /usr/share/postgresql-common/pgdg /etc/postgresql-common; \
    printf 'create_main_cluster = false\n' > /etc/postgresql-common/createcluster.conf; \
    echo 'deb [signed-by=/usr/share/postgresql-common/pgdg/apt.postgresql.org.asc] https://apt.postgresql.org/pub/repos/apt bookworm-pgdg main' \
      > /etc/apt/sources.list.d/pgdg.list; \
    apt-get update; \
    apt-get install -y --no-install-recommends \
      postgresql-18=18.4-1.pgdg12+1 \
      postgresql-client-18=18.4-1.pgdg12+1 \
      postgresql-18-pgvector=0.8.5-1.pgdg12+1; \
    rm -rf /var/lib/apt/lists/*; \
    /usr/lib/postgresql/18/bin/postgres --version; \
    test -f /usr/share/postgresql/18/extension/vector.control

WORKDIR /opt/noesar

# The application. `capabilities/`, `schemas/` and `docs/` are copied file by file and not as
# directories on purpose: the running image holds 2 files under `capabilities/` and 4 under
# `schemas/` where the repository holds 43 of each. Copying the directories would ship files
# the product has never contained — checked against the live image, not inferred.
COPY --chown=10001:10001 package.json /opt/noesar/
COPY --chown=10001:10001 services/reference-control-plane/ /opt/noesar/services/reference-control-plane/
COPY --chown=10001:10001 apps/webui-static/ /opt/noesar/apps/webui-static/
COPY --chown=10001:10001 database/ /opt/noesar/database/
COPY --chown=10001:10001 tools/acceptance/ /opt/noesar/tools/acceptance/
# The terminal shell itself. The WebUI's CodeN Evolution TUI page names this exact program
# and tells the reader to run it "from a real terminal on this host (or over SSH into it)" —
# and until phase 5 of CodeN Evolution the image did not contain it: only `tools/acceptance/`
# was copied out of `tools/`, so the socket sat listening at /run/codev-peer.sock inside the
# container with nothing shipped that could speak to it. Measured on the live installation,
# not inferred. A claim the deployment cannot satisfy is the sidebar's "not built" flag one
# layer down, and coden-addressable-panels.test.mjs now ties the page to this line.
COPY --chown=10001:10001 tools/tui-client.mjs /opt/noesar/tools/tui-client.mjs
COPY --chown=10001:10001 capabilities/security/trust-level-policy.json /opt/noesar/capabilities/security/trust-level-policy.json
COPY --chown=10001:10001 capabilities/security/permission-catalog.json /opt/noesar/capabilities/security/permission-catalog.json
COPY --chown=10001:10001 schemas/industry-module-manifest.schema.json /opt/noesar/schemas/industry-module-manifest.schema.json
COPY --chown=10001:10001 schemas/compliance-pack.schema.json /opt/noesar/schemas/compliance-pack.schema.json
COPY --chown=10001:10001 schemas/technology-radar-entry.schema.json /opt/noesar/schemas/technology-radar-entry.schema.json
COPY --chown=10001:10001 schemas/tool-catalog-entry.schema.json /opt/noesar/schemas/tool-catalog-entry.schema.json
COPY --chown=10001:10001 docs/governance/technology-radar-seed.json /opt/noesar/docs/governance/technology-radar-seed.json

COPY --from=rust-builder /build/rust/target/release/noesar-supervisord /opt/noesar/bin/noesar-supervisord
COPY --from=rust-builder /build/rust/target/release/noesar-sandbox /opt/noesar/bin/noesar-sandbox
RUN chmod 0755 /opt/noesar/bin/noesar-supervisord /opt/noesar/bin/noesar-sandbox

ENV NODE_ENV=production \
    NOESAR_RUNTIME_ROOT=/opt/noesar \
    NOESAR_WORKSPACE=/workspace \
    NOESAR_HOST=0.0.0.0 \
    NOESAR_PORT=8088 \
    NOESAR_RELEASE_CHANNEL=complete \
    NOESAR_AUTHORITY_MODE=reference-node \
    NOESAR_DATA_PLANE=postgresql \
    NOESAR_SETUP_TOKEN_FILE=/workspace/config/first-owner-setup.token \
    NOESAR_ALLOWED_HOSTS=localhost,127.0.0.1,::1 \
    # Where the terminal shell looks for the socket the server opens. The client's own
    # fallback is `<repo>/.workspace/tui.sock`, which is right for a from-source install and
    # wrong here — in the image the repo root is /opt/noesar while the socket lives on the
    # /run tmpfs. Without this, the command the WebUI prints would need an argument the
    # WebUI does not print. Measured in phase 5 by running the shipped client in the image.
    NOESAR_TUI_SOCKET_PATH=/run/codev-peer.sock \
    NOESAR_SECURE_COOKIES=false \
    NOESAR_POSTGRES_BINDIR=/usr/lib/postgresql/18/bin \
    NOESAR_POSTGRES_ROOT=/workspace/postgresql \
    NOESAR_MIGRATIONS_DIR=/opt/noesar/database/postgres \
    NOESAR_LOCAL_MODEL_RUNTIME=disabled \
    PATH=/usr/lib/postgresql/18/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin

USER 10001:10001
EXPOSE 8088
VOLUME ["/workspace"]

# Liveness, not readiness. The container must be restarted only when the process is
# genuinely dead; /healthz and /readyz report dependency state, so using either here
# would restart a perfectly alive process whenever a dependency is briefly degraded.
# Tries plain HTTP first (the default this product has always shipped); if that
# errors, retries over HTTPS with certificate verification off, because the
# healthcheck runs against its own process on loopback and is not a third party to
# authenticate. Runtime-configured (NOESAR_TLS_CERT_FILE/NOESAR_TLS_KEY_FILE), so
# which branch actually answers is unknown at build time; both are tried every check.
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD ["node", "-e", "const h=require('node:http'),s=require('node:https');function t(m,o){return new Promise((res,rej)=>{const r=m.get(o,(x)=>{x.resume();res(x.statusCode)});r.on('error',rej);r.setTimeout(4000,()=>r.destroy(new Error('timeout')))})}(async()=>{try{process.exit((await t(h,'http://127.0.0.1:8088/livez'))===200?0:1)}catch(e){try{process.exit((await t(s,{hostname:'127.0.0.1',port:8088,path:'/livez',rejectUnauthorized:false}))===200?0:1)}catch(e2){process.exit(1)}}})()"]

# ARCH-001: a thin supervisor is PID 1 and the api and postgres processes are its peers, not
# nested one inside the other. Before `D-0240` this was `node server.mjs`, which made postgres
# a child of the api process — one crash took both down.
ENTRYPOINT ["/opt/noesar/bin/noesar-supervisord"]
