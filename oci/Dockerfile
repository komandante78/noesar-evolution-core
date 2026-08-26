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
# The inference engine — a public, versioned release, pinned by DIGEST and not by the moving
# `:server-cuda` tag, so this line still produces the exact same bytes years from now. Recorded
# here rather than in a separate provenance file because a `FROM` pin already IS the
# reproducibility claim: `docker build` never re-resolves a digest, only a tag.
# ------------------------------------------------------------------------------------------
FROM ghcr.io/ggml-org/llama.cpp@sha256:4c0ece468721077a8bff8c114f8b0a92a8604ed310c91939fadfe37595a53b9e AS llama-runtime

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
 && apt-get install -y --no-install-recommends unzip poppler-utils tesseract-ocr ffmpeg ca-certificates libgomp1 \
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
# `D-0405` slice 1. The modules BOTH shells import — the slash-command registry and the CodeN
# address declaration — moved out of the web folder so that removing the web CodeN cannot take
# the terminal's vocabulary with it. They are needed by the browser (served at `/shared/`) AND
# by the terminal (imported off disk), so the image must carry them or `tui-client.mjs` throws
# on its first import — the fourth occurrence of the defect `tui-import-closure.test.mjs` was
# written to catch, and the first one that test caught before a build rather than after one.
COPY --chown=10001:10001 apps/shared/ /opt/noesar/apps/shared/
# `D-0526`. The extracted package the control plane now imports for verified acquisition —
# transport, descriptor authenticity and the canonical JSON encoder nine other modules reach
# through. Exactly the same failure the comment above describes, one directory over: without this
# line the server throws on its first import, and the image would be a container that starts,
# fails, and restarts for ever. `tui-import-closure.test.mjs` now walks the SERVER's import graph
# too, so this line is checked rather than remembered.
COPY --chown=10001:10001 packages/verified-acquisition/ /opt/noesar/packages/verified-acquisition/
COPY --chown=10001:10001 database/ /opt/noesar/database/
COPY --chown=10001:10001 tools/acceptance/ /opt/noesar/tools/acceptance/
# The terminal shell itself. The WebUI's CodeN Evolution TUI page names this exact program
# and tells the reader to run it "from a real terminal on this host (or over SSH into it)" —
# and until phase 5 of CodeN Evolution the image did not contain it: only `tools/acceptance/`
# was copied out of `tools/`, so the socket sat listening at /run/codev-peer.sock inside the
# container with nothing shipped that could speak to it. Measured on the live installation,
# not inferred. A claim the deployment cannot satisfy is the sidebar's "not built" flag one
# layer down, and coden-addressable-panels.test.mjs now ties the page to this line.
#
# Twice now the list below has been the defect rather than the fix. Phase 5 shipped
# `tui-client.mjs` after finding it absent; s319 then split the program into
# `tui-fullscreen.mjs` and `tui-screen.mjs` and this line still named one file, so a build
# from that tree would have put a program in the image whose very first `import` fails —
# the same outage as shipping nothing, arrived at by adding code rather than by forgetting
# it. A hand-kept copy list cannot track an import graph, so the pattern below covers the
# shell's modules and `tui-import-closure.test.mjs` derives the real closure and fails when
# a file it reaches is not covered here. The recipe is still explicit; what changed is that
# a divergence is now measured instead of noticed.
# Third time, and the guard did its job: phase 3c moved the address views into
# `coden-address-views.mjs` so both terminal shells could render them, and the closure test
# failed on this line before any container was built.
# Fourth time, same guard, same job: `D-0348` added `terminal-credential.mjs` — the file that
# decides where a remembered terminal keeps its token — and the closure test failed here
# before anything was built. Shipping without it would have been `D-0301`'s defect exactly: a
# shell in the image that throws on its first import.
COPY --chown=10001:10001 tools/tui-client.mjs tools/tui-fullscreen.mjs tools/terminal-credential.mjs /opt/noesar/tools/
# The launcher (phase 8). Shipped for a reason the import-closure guard above cannot see,
# because it is not a module and nothing imports it: on a container installation this is the
# file the HOST-side launcher re-enters the container to run, so an image without it turns
# rung 2 into `exec: no such file or directory` — which is precisely what phase 5's missing
# client looked like from outside the container. It is also how the recipe OBTAINS the
# host-side copy on a machine that has no repository, only the image.
# `launcher-portability.test.mjs` ties this line to the launcher, so the fourth occurrence
# of that class fails before a container is built.
COPY --chown=10001:10001 tools/coden-evolution /opt/noesar/tools/coden-evolution
# The Windows dialect, and the two installers. Measured absent on 2026-08-07: the image
# shipped the POSIX launcher alone, so a Windows account had nothing to extract and the
# recipe's own step 1 could not be carried out on the operating system whose section of
# that recipe is the longest. The installers ship for the same reason the launcher does —
# a machine that has only the image and no repository has to be able to obtain them — and
# because the route that serves them over the already-open port reads these exact paths.
COPY --chown=10001:10001 tools/coden-evolution.ps1 /opt/noesar/tools/coden-evolution.ps1
COPY --chown=10001:10001 deployment/container/install-coden-cli.sh /opt/noesar/tools/install-coden-cli.sh
COPY --chown=10001:10001 deployment/container/Install-CodenCli.ps1 /opt/noesar/tools/Install-CodenCli.ps1
COPY --chown=10001:10001 capabilities/security/trust-level-policy.json /opt/noesar/capabilities/security/trust-level-policy.json
COPY --chown=10001:10001 capabilities/security/permission-catalog.json /opt/noesar/capabilities/security/permission-catalog.json
# D-0625: il catalogo modelli curato che viaggia COL prodotto. Senza questa riga il file esiste
# nel repository e non nell immagine, e la pagina #/models torna vuota su ogni installazione
# nuova — che e esattamente il difetto che D-0625 ripara.
COPY --chown=10001:10001 capabilities/model-catalog-seed.json /opt/noesar/capabilities/model-catalog-seed.json
COPY --chown=10001:10001 schemas/industry-module-manifest.schema.json /opt/noesar/schemas/industry-module-manifest.schema.json
COPY --chown=10001:10001 schemas/compliance-pack.schema.json /opt/noesar/schemas/compliance-pack.schema.json
COPY --chown=10001:10001 schemas/technology-radar-entry.schema.json /opt/noesar/schemas/technology-radar-entry.schema.json
COPY --chown=10001:10001 schemas/tool-catalog-entry.schema.json /opt/noesar/schemas/tool-catalog-entry.schema.json
# `D-0559`, found by `tools/verify-image-provenance.sh` and not by reading: this line was
# MISSING while the running image carried the file. An overlay added it for `D-0521`, the fold
# that produced this file predates that overlay, and nothing compared the two — so the recipe
# that travels in the delivery archives shipped a product one published contract short of the
# one deployed. It is the schema `tools/sign-model-descriptor.mjs` validates against and the
# one `packages/verified-acquisition/test/descriptor-schema.test.mjs` reads off disk; the
# runtime validator implements its keywords in code and does not read it, which is exactly why
# the omission was invisible to every test and to the running container.
COPY --chown=10001:10001 schemas/model-descriptor.schema.json /opt/noesar/schemas/model-descriptor.schema.json
COPY --chown=10001:10001 docs/governance/technology-radar-seed.json /opt/noesar/docs/governance/technology-radar-seed.json

COPY --from=rust-builder /build/rust/target/release/noesar-supervisord /opt/noesar/bin/noesar-supervisord
COPY --from=rust-builder /build/rust/target/release/noesar-sandbox /opt/noesar/bin/noesar-sandbox
RUN chmod 0755 /opt/noesar/bin/noesar-supervisord /opt/noesar/bin/noesar-sandbox

# ATOM, inside the product — Owner, s335.
#
# «Quando installano deve esserci tutto.» Until this line, this file contained the string
# `atom` zero times: the product's distinguishing chain (model → ATOM checks and regenerates →
# answer) was configured on one machine by hand and did not exist for anyone who installed the
# image. ATOM keeps its own repository — a source-control boundary is not a delivery boundary —
# and what ships here is its BUILT artefact with a recorded origin
# (`oci/vendor/atom/atomd.provenance.json`, and `REFRESH.md` beside it for replacing it).
#
# The digest is asserted AFTER the copy and inside the image, not before it in the repository.
# A test proves what is in the tree; only this proves what is in the layer — and this project has
# already been bitten by a build that reported `CACHED` while carrying different bytes.
COPY --chown=10001:10001 oci/vendor/atom/atomd /opt/noesar/bin/atomd
COPY --chown=10001:10001 oci/vendor/atom/atomd.provenance.json /opt/noesar/bin/atomd.provenance.json
RUN chmod 0755 /opt/noesar/bin/atomd \
 && DECLARED="$(sed -n 's/.*"sha256": *"\([0-9a-f]\{64\}\)".*/\1/p' /opt/noesar/bin/atomd.provenance.json)" \
 && ACTUAL="$(sha256sum /opt/noesar/bin/atomd | cut -d' ' -f1)" \
 && [ -n "$DECLARED" ] || { echo "atomd provenance declares no sha256" >&2; exit 1; } \
 && [ "$DECLARED" = "$ACTUAL" ] || { echo "atomd digest mismatch: declared=$DECLARED image=$ACTUAL" >&2; exit 1; }

# The inference engine, inside the product too — Owner, 2026-08-26.
#
# «Deve essere tutto dentro un solo container... automatico su tutti i dispositivi.» Same
# motivation as the ATOM block above: until this line, chat only answered because a SIBLING
# container (`atom-evolution-model`) was started by hand, on a host this image had no GPU access
# to even if it had wanted to run it. Unlike ATOM, llama.cpp is not a second repository this one
# must vendor a built copy of — it is a public, versioned release, so the `llama-runtime` stage
# above pulls it directly, pinned to an image DIGEST rather than the moving `:server-cuda` tag,
# which is the same reproducibility guarantee atomd's provenance file gives by hand.
#
# A first attempt committed the extracted files under `oci/vendor/llama-cpp/` instead, mirroring
# atomd literally. That does not work for THIS artefact: `libggml-cuda.so` alone is 159MB, and
# GitHub refuses any single file over 100MB outright — measured by the push failing, not by
# reading a limits page first. The digest pin below is the correct shape, not a workaround for
# the size limit: it needs no repository storage at all, and `docker build` re-resolves nothing
# behind that digest for as long as this line names it.
COPY --from=llama-runtime --chown=10001:10001 /app/ /opt/noesar/llama-runtime/
RUN chmod 0755 /opt/noesar/llama-runtime/llama-server

# `llama-runtime`'s own base is newer than ${NODE_IMAGE} (bookworm, glibc 2.36): measured by
# running the copied binary, not by comparing version numbers first — it failed with
# `GLIBC_2.38' not found` and three more symbols one level down in libstdc++. Rebasing this whole
# image to chase one binary's toolchain is not on the table (`postgresql-18=18.4-1.pgdg12+1`
# above is pinned to bookworm-pgdg specifically), and neither is patching the system's own libc,
# which every other process in this container also links against. So the files a portable Linux
# binary actually needs — the dynamic LOADER and the libraries under its version floor — travel
# alongside it instead, invoked explicitly rather than trusted to the base image's own `/lib`:
# `local-model.json`'s `launchCommand` names the vendored loader first, with `--library-path`
# pointed at this directory, so resolution never falls through to the host copies these
# deliberately do not replace. Verified by running the result, the same way the defect was found.
COPY --from=llama-runtime --chown=10001:10001 \
  /usr/lib/x86_64-linux-gnu/ld-linux-x86-64.so.2 \
  /usr/lib/x86_64-linux-gnu/libgcc_s.so.1 \
  /usr/lib/x86_64-linux-gnu/libm.so.6 \
  /usr/lib/x86_64-linux-gnu/libstdc++.so.6 \
  /usr/lib/x86_64-linux-gnu/libstdc++.so.6.0.33 \
  /lib/x86_64-linux-gnu/libc.so.6 \
  /opt/noesar/llama-runtime/
RUN chmod 0755 /opt/noesar/llama-runtime/ld-linux-x86-64.so.2

# The CUDA TOOLKIT runtime, distinct from the CUDA DRIVER: `nvidia-container-toolkit` injects
# `libcuda.so.1` and the device nodes at container start (a property of the HOST's driver, and
# already how `atom-evolution-model` got GPU access) — but `libcudart.so.12`, `libcublas.so.12`
# and `libcublasLt.so.12` are toolkit components the llama.cpp build links against and no host
# ever provides, because they are not part of any driver. `--list-devices` reported "no usable
# GPU found" with `LD_DEBUG=libs` showing every one of these three searched for and found
# nowhere — not a driver problem, a missing dependency one layer down from it. cuBLAS is the
# size cost of GPU support at all here (~870MB of the two `so.12.8.4.1` files, bundled kernels
# for architectures this one GPU will never run): the alternative is every chat answer coming
# from CPU on hardware that has a GPU sitting idle next to it, which is the worse trade.
#
# `libnccl.so.2` is the FOURTH member of that same family, and it was missed here until 26/08
# because the hunt above stopped the moment `--list-devices` named a GPU. Without it
# `libggml-cuda.so` cannot be dlopen'd at all (`libnccl.so.2: cannot open shared object file`),
# llama.cpp SWALLOWS that failure, `-ngl 99` goes inert, and every surface answers from the CPU
# — measured at 9.4 tok/s against ~62 on this same GPU. The failure prints nothing unless
# `GGML_BACKEND_PATH` names the file explicitly, which is how this product came to log
# `profile: "cuda:0"` for a model it was running on the processor. NCCL itself is multi-GPU
# collective communication this installation will never call: it is a LINK dependency of the
# CUDA backend, needed to LOAD it, not to use it. Same symlink-plus-real-file pair as cuBLAS
# above, so the ~366MB is paid once.
COPY --from=llama-runtime --chown=10001:10001 \
  /usr/local/cuda-12.8/targets/x86_64-linux/lib/libcudart.so.12 \
  /usr/local/cuda-12.8/targets/x86_64-linux/lib/libcudart.so.12.8.90 \
  /usr/local/cuda-12.8/targets/x86_64-linux/lib/libcublas.so.12 \
  /usr/local/cuda-12.8/targets/x86_64-linux/lib/libcublas.so.12.8.4.1 \
  /usr/local/cuda-12.8/targets/x86_64-linux/lib/libcublasLt.so.12 \
  /usr/local/cuda-12.8/targets/x86_64-linux/lib/libcublasLt.so.12.8.4.1 \
  /usr/lib/x86_64-linux-gnu/libnccl.so.2 \
  /usr/lib/x86_64-linux-gnu/libnccl.so.2.25.1 \
  /opt/noesar/llama-runtime/

# The gesture, inside the container too. `docker exec <c> coden_evolution` and a terminal
# opened into the container both get the same one word the host gets — the underscore is the
# Owner's, fixed in `16` §4.2b, while the repository file keeps the hyphen every other tool
# in tools/ uses. Two spellings of one file, and the symlink is where they meet, so no copy
# can drift from the other. Executable bit set explicitly rather than inherited: a COPY
# preserves the source mode, and a repository checked out on a filesystem that does not
# carry the bit (a Windows build host) would otherwise ship a launcher nobody can run.
RUN chmod 0755 /opt/noesar/tools/coden-evolution /opt/noesar/tools/install-coden-cli.sh \
 && ln -sf /opt/noesar/tools/coden-evolution /usr/local/bin/coden_evolution

# The build host stops leaking its umask into the product — `D-0559`, measured, not suspected.
#
# `COPY` preserves the source mode. On the machine this image has always been built on, the
# repository lives on a share where every file is `666` and every script `777`, so the LIVE
# image ships the application **world-writable** and two acceptance scripts world-writable AND
# world-executable. Only the documented `--read-only` root filesystem has been standing between
# that and a container process rewriting the product's own source; an operator who omits the
# flag gets no such protection, and nothing anywhere said so.
#
# It is also why two builds of the same commit on two machines produce different images: a
# developer with a normal `022` umask gets `644`, this host gets `666`, and the delivery
# archives would carry whichever host happened to build them. Reproducibility is not a property
# a recipe can claim while the answer depends on where it ran.
#
# The rule below keeps the one mode bit git actually tracks — the executable bit — and fixes
# the rest: directories `0755`, executables `0755`, everything else `0644`. The explicit
# `chmod`s above stay where they are: each sits next to the step that asserts something about
# that file, and this one is a property of the whole tree, not of any file in it.
#
# `-type f` on the final assertion too, added when `oci/vendor/llama-cpp` (2026-08-26) put this
# repository's first symlinks under /opt/noesar: `find -perm -o+w` with no type filter matches a
# symlink's OWN mode bits, which are conventionally `lrwxrwxrwx` and meaningless — the kernel
# enforces the TARGET's permissions when the link is followed, and every target here already went
# through the `-type f` passes above. Asserting on the link too would refuse a tree that is
# actually fine, for a reason this exact check exists to catch never actually being true.
RUN find /opt/noesar -type d -exec chmod 0755 {} + \
 && find /opt/noesar -type f -perm -u+x -exec chmod 0755 {} + \
 && find /opt/noesar -type f ! -perm -u+x -exec chmod 0644 {} + \
 && test "$(find /opt/noesar -type f -perm -o+w | wc -l)" = "0"

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
    # Where the terminal shell looks for the socket. The client's own fallback is
    # `<repo>/.workspace/tui.sock`, which is right for a from-source install and wrong here —
    # in the image the repo root is /opt/noesar while the socket lives on the /run tmpfs.
    # Without this, the command the WebUI prints would need an argument it does not print.
    #
    # It must NOT be `/run/codev-peer.sock`, and it WAS, from phase 5 until D-0338. That is
    # the supervisor's INTERNAL path: `noesar-supervisor/src/lib.rs` hard-codes
    # `NOESAR_CODEV_PEER_SOCKET_PATH=/run/codev-peer.sock` for both `api` and `codev` on
    # purpose, so the two children agree without either being told the other's variable name.
    # Pointing the EXTERNAL path at that same value made the relay bind the socket `api` was
    # about to listen on: `session-protocol.mjs` then correctly refused to steal a live socket
    # (D-0328) and logged `tui.socket-unavailable`, and a client reaching the relay would have
    # been relayed to the relay.
    #
    # Measured on the live installation, and true for every deployment since phase 5: the
    # terminal transport was never served in production. The socket file existed, the
    # container reported healthy, every status agreed, and the only trace was a single ERROR
    # line at startup. `createRelay` now refuses this configuration outright.
    #
    # `/run` and not `/workspace`: container-local tmpfs, so the socket is never published
    # onto a host bind mount — the first of the three traps in `16` §4.3, and §2.3 of
    # docs/CODEN_EVOLUTION_TERMINAL_ACCESS.md.
    NOESAR_TUI_SOCKET_PATH=/run/codev-tui.sock \
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
