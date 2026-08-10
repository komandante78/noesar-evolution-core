#!/usr/bin/env bash
# NOESAR EVOLUTION — synthetic fixture tests for the identity-based container baseline
# (.claude/hooks/lib/container-baseline.sh), the mechanism behind SessionStart's capture
# and the Stop hook's check 6.
#
# No real docker container is created, started, stopped, or removed anywhere in this
# file. Every "current" and "baseline" state is a literal JSON fixture fed straight into
# cbl_check_containers — the same pure function the real Stop hook calls, just with the
# real cbl_fetch_all_containers() bypassed by construction (we pass CURRENT_JSON directly,
# we never call it here).
#
# Usage: ./test-container-baseline.sh   (exit 0 = all pass, exit 1 = at least one failure)
set -u

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LIB="$HERE/../lib/container-baseline.sh"
# shellcheck source=../lib/container-baseline.sh
. "$LIB"

TMPDIR="$(mktemp -d /tmp/noesar-cbl-test.XXXXXX)"
trap 'rm -rf "$TMPDIR"' EXIT

PASS=0
FAIL=0

# assert_contains OUTPUT PREFIX SUBSTRING DESCRIPTION
# Passes if at least one line of OUTPUT starts with PREFIX ("FAIL:" or "DEBT:") and
# contains SUBSTRING.
assert_contains() {
  local output="$1" prefix="$2" substr="$3" desc="$4"
  if printf '%s\n' "$output" | grep -F "$prefix" | grep -qF "$substr"; then
    echo "  ok   - $desc"
    PASS=$((PASS+1))
  else
    echo "  FAIL - $desc"
    echo "         expected a line starting with '$prefix' containing '$substr'"
    echo "         got:"
    printf '%s\n' "$output" | sed 's/^/           /'
    FAIL=$((FAIL+1))
  fi
}

# assert_absent OUTPUT SUBSTRING DESCRIPTION
assert_absent() {
  local output="$1" substr="$2" desc="$3"
  if printf '%s\n' "$output" | grep -qF "$substr"; then
    echo "  FAIL - $desc"
    echo "         did not expect any line containing '$substr'"
    echo "         got:"
    printf '%s\n' "$output" | sed 's/^/           /'
    FAIL=$((FAIL+1))
  else
    echo "  ok   - $desc"
    PASS=$((PASS+1))
  fi
}

assert_no_fail() {
  local output="$1" desc="$2"
  if printf '%s\n' "$output" | grep -q '^FAIL:'; then
    echo "  FAIL - $desc"
    echo "         expected zero FAIL: lines, got:"
    printf '%s\n' "$output" | sed 's/^/           /'
    FAIL=$((FAIL+1))
  else
    echo "  ok   - $desc"
    PASS=$((PASS+1))
  fi
}

entry() { # entry ID NAME [LABELS_JSON]
  local id="$1" name="$2" labels="${3:-}"
  [ -z "$labels" ] && labels='{}'
  printf '{"id":"%s","name":"%s","created":"2026-08-10T00:00:00Z","image_id":"sha256:x","labels":%s}' "$id" "$name" "$labels"
}

echo "=== 1. same name, same id: not new, not blocked ==="
BASE="[$(entry idA noesar-evolution-old-d0300)]"
CUR="[$(entry idA noesar-evolution-old-d0300)]"
printf '%s' "$BASE" > "$TMPDIR/base1.json"
OUT="$(cbl_check_containers "$TMPDIR/base1.json" "$CUR" sessA "$TMPDIR/no-such-marker")"
assert_no_fail "$OUT" "identical id+name across baseline and current produces no FAIL"

echo "=== 2. same name, different id: new and blocked ==="
BASE="[$(entry idA noesar-evolution-old-d0300)]"
CUR="[$(entry idB noesar-evolution-old-d0300)]"
printf '%s' "$BASE" > "$TMPDIR/base2.json"
OUT="$(cbl_check_containers "$TMPDIR/base2.json" "$CUR" sessA "$TMPDIR/no-such-marker")"
assert_contains "$OUT" "FAIL:" "noesar-evolution-old-d0300 (idB" "same name, different id (rename+recreate) is caught as new and blocks"

echo "=== 3. different name, new id, but NOESAR-scoped by label: new and blocked ==="
BASE="[$(entry idA noesar-evolution-old-d0300)]"
NOESAR_LABELS='{"org.noesar.phase":"4"}'
CUR="[$(entry idA noesar-evolution-old-d0300), $(entry idC some-renamed-noesar-thing "$NOESAR_LABELS")]"
printf '%s' "$BASE" > "$TMPDIR/base3.json"
OUT="$(cbl_check_containers "$TMPDIR/base3.json" "$CUR" sessA "$TMPDIR/no-such-marker")"
assert_contains "$OUT" "FAIL:" "some-renamed-noesar-thing (idC" "a new id under a non-prefixed name but with an org.noesar.* label still blocks"

echo "=== 3b. different name, new id, NOT NOESAR-scoped: new but only a debt, not blocked ==="
BASE="[$(entry idA noesar-evolution-old-d0300)]"
CUR="[$(entry idA noesar-evolution-old-d0300), $(entry idD some-other-project-container)]"
printf '%s' "$BASE" > "$TMPDIR/base3b.json"
OUT="$(cbl_check_containers "$TMPDIR/base3b.json" "$CUR" sessA "$TMPDIR/no-such-marker")"
assert_absent "$OUT" "FAIL:some-other-project-container" "an external (non-NOESAR) new container never produces a FAIL"
assert_contains "$OUT" "DEBT:" "some-other-project-container (idD" "an external new container is still reported, as a non-blocking debt"

echo "=== 4. container present in baseline: not blocked ==="
BASE="[$(entry idA noesar-evolution)]"
CUR="[$(entry idA noesar-evolution)]"
printf '%s' "$BASE" > "$TMPDIR/base4.json"
OUT="$(cbl_check_containers "$TMPDIR/base4.json" "$CUR" sessA "$TMPDIR/no-such-marker")"
assert_no_fail "$OUT" "a container that was already in the baseline is never blocked"

echo "=== 5. new container but already removed before closure: not blocked ==="
BASE="[$(entry idA noesar-evolution)]"
CUR="[$(entry idA noesar-evolution)]"   # the transient container idX never appears in CURRENT at all
printf '%s' "$BASE" > "$TMPDIR/base5.json"
OUT="$(cbl_check_containers "$TMPDIR/base5.json" "$CUR" sessA "$TMPDIR/no-such-marker")"
assert_no_fail "$OUT" "a container created and removed again before Stop never appears in current, so it cannot block"

echo "=== 6. baseline file present but corrupted (not valid JSON): error/block ==="
printf 'not { valid json' > "$TMPDIR/base6.json"
CUR="[$(entry idA noesar-evolution)]"
OUT="$(cbl_check_containers "$TMPDIR/base6.json" "$CUR" sessA "$TMPDIR/no-such-marker")"
assert_contains "$OUT" "FAIL:" "not a valid JSON array — corrupted" "a corrupted baseline file blocks, not silently passes"

echo "=== 7. baseline missing, exempt bootstrap session: explicit non-blocking warning ==="
printf 'sess-bootstrap-1' > "$TMPDIR/marker7.txt"
CUR="[$(entry idA noesar-evolution)]"
OUT="$(cbl_check_containers "$TMPDIR/does-not-exist7.json" "$CUR" sess-bootstrap-1 "$TMPDIR/marker7.txt")"
assert_no_fail "$OUT" "the one session_id named by the bootstrap marker gets no FAIL for a missing baseline"
assert_contains "$OUT" "DEBT:" "BASELINE_UNAVAILABLE_PREINSTALL" "...and gets an explicit BASELINE_UNAVAILABLE_PREINSTALL debt instead"

echo "=== 7b. baseline missing, NOT the exempt session: blocks (fails closed, not open) ==="
printf 'sess-bootstrap-1' > "$TMPDIR/marker7b.txt"
CUR="[$(entry idA noesar-evolution)]"
OUT="$(cbl_check_containers "$TMPDIR/does-not-exist7b.json" "$CUR" sess-some-other-session "$TMPDIR/marker7b.txt")"
assert_contains "$OUT" "FAIL:" "container baseline missing for this session" "any session other than the named bootstrap exemption blocks on a missing baseline"

echo "=== 8. B-012: >1 rollback containers pre-existing: non-blocking debt, not a FAIL ==="
BASE="[$(entry idA noesar-evolution-old-d0300), $(entry idB noesar-evolution-old-d0299), $(entry idC noesar-evolution-old-d0298)]"
CUR="$BASE"
printf '%s' "$BASE" > "$TMPDIR/base8.json"
OUT="$(cbl_check_containers "$TMPDIR/base8.json" "$CUR" sessA "$TMPDIR/no-such-marker")"
assert_no_fail "$OUT" "3 pre-existing rollback containers (all in baseline) never produce a FAIL"
assert_contains "$OUT" "DEBT:" "B-012" "...but are reported as the B-012 non-blocking debt"

echo
echo "=== cbl_is_noesar_scoped unit checks ==="
if entry idX noesar-evolution-old-d0300 | cbl_is_noesar_scoped; then
  echo "  ok   - name-prefix match recognised as NOESAR-scoped"; PASS=$((PASS+1))
else
  echo "  FAIL - name-prefix match should be NOESAR-scoped"; FAIL=$((FAIL+1))
fi
if entry idX totally-unrelated-container | cbl_is_noesar_scoped; then
  echo "  FAIL - unrelated name+no labels should NOT be NOESAR-scoped"; FAIL=$((FAIL+1))
else
  echo "  ok   - unrelated name+no labels correctly NOT NOESAR-scoped"; PASS=$((PASS+1))
fi

echo
echo "=== SessionStart write / Stop read round-trip via NOESAR_GUARD_FAKE_DOCKER_JSON ==="
FAKE="[$(entry idA noesar-evolution), $(entry idB noesar-evolution-voice-hear)]"
printf '%s' "$FAKE" > "$TMPDIR/fake-docker.json"
RESULT="$(NOESAR_GUARD_FAKE_DOCKER_JSON="$TMPDIR/fake-docker.json" cbl_fetch_all_containers)"
if [ "$(jq -c 'sort_by(.id)' <<<"$RESULT" 2>/dev/null)" = "$(jq -c 'sort_by(.id)' <<<"$FAKE" 2>/dev/null)" ]; then
  echo "  ok   - cbl_fetch_all_containers returns the fixture verbatim under the test override"; PASS=$((PASS+1))
else
  echo "  FAIL - fixture round-trip through cbl_fetch_all_containers did not match"; FAIL=$((FAIL+1))
fi

echo
echo "=== label secret-scrubbing: a secret-shaped label VALUE is dropped, key is not, no docker call made ==="
cat > "$TMPDIR/inspect-shape.json" <<'EOF'
[
  {"Id":"deadbeef","Name":"/noesar-evolution","Created":"2026-08-10T00:00:00Z","Image":"sha256:x",
   "Config":{"Labels":{"org.noesar.phase":"4","ATOM_TOKEN":"shh-secret-value-should-not-survive"}}}
]
EOF
# cbl_fetch_all_containers only reads real docker inspect output shaped like this via a live
# daemon; here we exercise the same jq transform in isolation to prove the scrub works,
# without needing a real container.
SCRUBBED="$(jq -c --arg pat "$CBL_SECRET_PATTERN" '
  [.[] | {id:.Id,name:(.Name|ltrimstr("/")),created:.Created,image_id:.Image,
          labels:((.Config.Labels // {}) | with_entries(select(.value | test($pat;"i") | not)))}]
' "$TMPDIR/inspect-shape.json")"
if printf '%s' "$SCRUBBED" | jq -e '.[0].labels | has("ATOM_TOKEN") | not' >/dev/null 2>&1 \
   && printf '%s' "$SCRUBBED" | jq -e '.[0].labels["org.noesar.phase"] == "4"' >/dev/null 2>&1; then
  echo "  ok   - secret-shaped label value scrubbed, unrelated label preserved"; PASS=$((PASS+1))
else
  echo "  FAIL - label scrubbing transform did not behave as expected"; echo "$SCRUBBED"; FAIL=$((FAIL+1))
fi

echo
echo "================================================================"
echo "container-baseline fixture tests: $PASS passed, $FAIL failed"
echo "================================================================"
[ "$FAIL" -eq 0 ]
