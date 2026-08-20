#!/usr/bin/env sh
# Verification entry point.
#
# Every step is named, and the summary at the end says which ran, which failed, and which could
# not run at all. It used to be a bare list under `set -eu`: the second step began failing when
# migrations 0013-0016 landed, and the five steps after it silently stopped running for good.
# Nothing announced that; the script just stopped. So the failure of one step no longer hides
# the existence of the others, and a step that cannot run is DECLARED, never counted as passed.
set -u
ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
# Guarded because this script deliberately does NOT use `set -e` (see above): without
# the guard a failed cd is not fatal, and every step below would then run against
# whatever directory the caller happened to be in — reporting results for a tree that
# is not this one. Dropping `set -e` fixed one silent failure and opened this one.
cd "$ROOT" || { printf '%s\n' "FATAL: cannot enter repository root: $ROOT" >&2; exit 1; }
PYTHON=${NOESAR_PYTHON:-python3}

PASSED=0
FAILED=0
UNAVAILABLE=0
PARTIAL=0
FAILED_STEPS=''
UNAVAILABLE_STEPS=''
PARTIAL_STEPS=''

# Runs a Python verifier even when python3 is not installed on this host: an offline,
# throwaway `python:3-slim` container carries it instead, the same pattern already used
# for Rust (`tools/test.sh`, `rust:1-bookworm`) and for ESLint (`tools/run-eslint.sh`,
# `node:22-bookworm-slim`). CLAUDE10.md rule 20 forbids installing anything on the host,
# even temporarily; this is the sanctioned alternative rule 21a names — a transient
# container, removed by `--rm` whether the check passes or fails. The mount is read-only
# because every verifier here only reads the tree; none of the four needs to write to it.
pyrun() {
  if command -v "$PYTHON" >/dev/null 2>&1; then
    "$PYTHON" "$@"
  elif command -v docker >/dev/null 2>&1; then
    docker run --rm --network none -v "$ROOT:/repo:ro" -w /repo python:3-slim python3 "$@"
  else
    return 127
  fi
}

step() {
  name=$1
  shift
  if [ "$1" = "pyrun" ] && ! command -v "$PYTHON" >/dev/null 2>&1 && ! command -v docker >/dev/null 2>&1; then
    printf '%s\n' "STEP $name = UNAVAILABLE (no $PYTHON and no docker on this host)"
    UNAVAILABLE=$((UNAVAILABLE + 1))
    UNAVAILABLE_STEPS="$UNAVAILABLE_STEPS $name"
    return 0
  fi
  if "$@"; then
    printf '%s\n' "STEP $name = PASS"
    PASSED=$((PASSED + 1))
  else
    printf '%s\n' "STEP $name = FAIL"
    FAILED=$((FAILED + 1))
    FAILED_STEPS="$FAILED_STEPS $name"
  fi
}

# Some tools report three states, not two: 0 pass, 1 fail, 2 "one half of me could not
# run here". Collapsing that third state onto FAIL is the mistake this script exists to
# avoid — an expected red is a red everybody learns to skip, and it would hide a real
# one appearing beside it. Used ONLY for tools documented to follow this convention;
# assuming it globally would silently downgrade a genuine failure that happened to
# exit 2.
step_tristate() {
  name=$1
  shift
  "$@"
  case $? in
    0) printf '%s\n' "STEP $name = PASS"; PASSED=$((PASSED + 1)) ;;
    2) printf '%s\n' "STEP $name = PARTIAL (declared by the tool, NOT counted as passed)"
       PARTIAL=$((PARTIAL + 1)); PARTIAL_STEPS="$PARTIAL_STEPS $name" ;;
    *) printf '%s\n' "STEP $name = FAIL"
       FAILED=$((FAILED + 1)); FAILED_STEPS="$FAILED_STEPS $name" ;;
  esac
}

step unit            node --test services/reference-control-plane/test/*.test.mjs
step source-verify   node tools/verify-source.mjs
step auth-smoke      node tools/auth-http-smoke.mjs
# D-0546. `packages/verified-acquisition/` is an extracted, separately-documented component with
# its own tests, and this runner invoked none of them: they existed only behind the npm script
# `test:conformance-package`, which nothing calls. That is the same failure the comment below
# describes, found again one component later — so the package's suite and the signing tool's
# end-to-end test are named here, where the battery can see them.
step package-va      node --test packages/verified-acquisition/test/*.test.mjs
step sign-descriptor node tools/test-sign-model-descriptor.mjs
# D-0551. The VA-012 vectors, executed by an implementation that shares no line of code with the
# encoder that produced them. Until this step existed, "any language can be measured against these
# bytes" was a requirement written down, never a result: every run had been the JavaScript side
# agreeing with itself. It runs through `pyrun` like the other Python steps, so a host with
# neither python3 nor docker gets an honest UNAVAILABLE rather than a silent skip.
step canon-python    pyrun packages/verified-acquisition/conformance/python/run_vectors.py
# D-0556. The 53 acceptance criteria of MASTER_PROJECT stop being prose: this fails when a
# document and docs/acceptance-matrix.json disagree, when a criterion states no method of
# verification, or when the number of criteria carrying NO verdict at all gets worse. It never
# decides that a criterion passes — status is read from the document that owns it, never inferred.
step matrix          node tools/verify-acceptance-matrix.mjs
# D-0588. "The five archives" named two different artifacts across eight places in the tree, and
# MASTER_PROJECT enumerated them nowhere — the product's last definition-of-done clause had no
# readable content. This holds the single canonical list, proves it still matches the five names
# incised in the sealed archives' own filenames, and refuses a governing document that says
# "the five archives" without saying which instance it means.
step five-archives   node tools/verify-five-archives.mjs
# D-0592. CE-032's stated method is "avvio su un'installazione da sorgenti E su una in
# contenitore". The source half is executed thirty-six ways in launcher-portability.test.mjs;
# the container half was three assert.match calls against the TEXT of oci/Dockerfile, which
# cannot see a COPY that lands elsewhere, a shadowed symlink, or a launcher that dies at its
# shebang. This runs the one word inside a disposable container built from the product's own
# image, offline, removed by --rm. Tristate: a host with no Docker gets an honest UNAVAILABLE.
step_tristate ce032-container tools/acceptance/ce-032-launcher-in-container.sh
# D-0594. CE-031 — "the session is reachable by a user who is NOT an administrator of the host,
# on the host and from another machine" — carried no verdict at all, while the installation
# ledger recorded it ✅ from a 2026-08-07 run that created a system account, three sudoers rules
# and an sshd block on THIS host: a modification the platform law forbids the product to make,
# which /etc-in-RAM then deleted at the next boot. This raises a disposable installation, a
# second machine with its own network namespace, an unprivileged uid and no engine socket, and
# has it register and DRIVE the session over TCP — then asks the same of an unprivileged account
# on the host. Tristate: a host with no engine gets an honest UNAVAILABLE.
step_tristate ce031-second-machine tools/acceptance/ce-031-second-machine.sh
# Both of these existed, worked, and were run by nothing. http-smoke had been crashing
# for several phases on endpoints correctly moved behind authentication, and
# packaging-filters is the regression test .gitignore cites by name for the anchoring
# rules that once deleted real vendored source. A check no runner invokes is a check
# that rots, and neither failure was visible until it was looked for on purpose.
step http-smoke      node tools/http-smoke.mjs
step_tristate tls-smoke node tools/tls-smoke.mjs
step_tristate packaging node tools/test-packaging-filters.mjs
step pg-migrations   pyrun tools/verify-postgres-migrations.py
step pg-contract     pyrun tools/verify-postgres-contract.py
step rust-source     pyrun tools/verify-rust-authority-source.py
step rust-provenance pyrun tools/test-rust-build-provenance.py -q
# The governance suites (hooks, guards, and the rule-12 single-source alignment) were in exactly
# the position the comment above describes: green, and invoked by nothing. Added 2026-08-17,
# D-0511. Skipped with a declaration — never silently — where the checkout has no .claude/, since
# these test this workspace's governance and not the shipped product.
if [ -x .claude/hooks/test/run-all.sh ]; then
  step governance      .claude/hooks/test/run-all.sh
else
  printf '%s\n' "STEP governance = UNAVAILABLE (.claude/hooks/test/run-all.sh not present)"
  UNAVAILABLE=$((UNAVAILABLE + 1)); UNAVAILABLE_STEPS="$UNAVAILABLE_STEPS governance"
fi

printf '\n%s\n' "TEST_SUMMARY pass=$PASSED fail=$FAILED partial=$PARTIAL unavailable=$UNAVAILABLE"
[ "$FAILED" -eq 0 ] || printf '%s\n' "FAILED:$FAILED_STEPS"
[ "$PARTIAL" -eq 0 ] || printf '%s\n' "PARTIAL (declared, NOT passed):$PARTIAL_STEPS"
[ "$UNAVAILABLE" -eq 0 ] || printf '%s\n' "UNAVAILABLE (declared, NOT passed):$UNAVAILABLE_STEPS"
[ "$FAILED" -eq 0 ]
