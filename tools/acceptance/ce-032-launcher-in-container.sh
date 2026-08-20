#!/bin/sh
# SPDX-License-Identifier: AGPL-3.0-or-later
#
# CE-032, the half that was asserted and never executed — `D-0592`.
#
# The criterion's own stated method is *"avvio su un'installazione DA SORGENTI e su una IN
# CONTENITORE, senza modificare l'host"*. `launcher-portability.test.mjs` executes the source
# half thoroughly — thirty-six rungs, the launcher run for real against stub engines on a
# synthetic PATH, with the argv they received as the assertion. The container half was three
# `assert.match` calls against the TEXT of `oci/Dockerfile`:
#
#     test('the one word works inside the container too', () => {
#       assert.match(instructions, /ln -sf \/opt\/noesar\/tools\/coden-evolution \/usr\/local\/bin\/coden_evolution/);
#     });
#
# That proves the Dockerfile SAYS so. It cannot see a `COPY` that lands somewhere else, a
# `chmod` on a path that moved, a symlink shadowed later in the build, a base image with no
# `sh`, or a launcher that dies at its shebang. This project has already shipped exactly that
# defect once — a page that offered to run a client which was not in the image — and the file
# above says in its own header that reading is not testing. Its container half was reading.
#
# So this runs the word INSIDE a container built from the product's own image, offline, and
# removes it in the same breath (`--rm`, `--network none`).
#
#   tools/acceptance/ce-032-launcher-in-container.sh [image]
#
# Exit 0 = executed and passed · 1 = executed and failed · 2 = could not be executed here, and
# says why. Two is not a pass and `step_tristate` in `scripts/test.sh` refuses to count it as
# one — a host with no Docker gets an honest declaration, never a silent skip (`D-0225`).
set -eu

fail=0
check() {
  if [ "$1" = 0 ]; then printf 'PASS  %s\n' "$2"; else printf 'FAIL  %s  — %s\n' "$2" "${3:-}"; fail=$((fail + 1)); fi
}

# `verify <description> <detail-on-failure> -- <test command…>`
#
# Written this way after the first version of this file could not report a failure AT ALL. It
# said `[ "$(field RESOLVED)" = /usr/local/bin/coden_evolution ]` on its own line and then
# `check $?`, which reads correctly and is fatal under `set -eu`: a false `[` returns 1, the
# shell leaves immediately, and the script prints no FAIL line and **exits 0**. Every assertion
# happened to be true against the real image, so it looked green; run against an image with no
# launcher it printed the probe output and claimed success.
#
# That is `D-0390` again — *"`grep -c` exits 1 when it counts zero and the ERR trap was armed"*,
# which nearly rolled back a perfectly good deployment — in the same corner of the product, one
# phase later. A condition inside `if` is exempt from `set -e`; a bare one is not.
verify() {
  desc=$1; detail=$2; shift 3   # the third argument is the literal `--`
  if "$@"; then check 0 "$desc"; else check 1 "$desc" "$detail"; fi
}
equals() { [ "$1" = "$2" ]; }
differs() { [ "$1" != "$2" ]; }
both() { "$1" "$2" "$3" && "$4" "$5" "$6"; }

if ! command -v docker >/dev/null 2>&1; then
  printf 'CE032_CONTAINER=UNAVAILABLE  no container engine on this host; the source half is covered by launcher-portability.test.mjs\n'
  exit 2
fi

# The image, in the order that keeps this honest on a machine that is not this one: what the
# caller named, else what the running installation is actually built from, else the newest
# product tag. Never a hardcoded tag — a tag written here would rot the day it is rebuilt.
image=${1:-${NOESAR_CE032_IMAGE:-}}
if [ -z "$image" ]; then
  image=$(docker inspect noesar-evolution --format '{{.Config.Image}}' 2>/dev/null || true)
fi
if [ -z "$image" ]; then
  image=$(docker images --format '{{.Repository}}:{{.Tag}}' 'noesar-evolution' 2>/dev/null | head -n 1 || true)
fi
if [ -z "$image" ]; then
  printf 'CE032_CONTAINER=UNAVAILABLE  no noesar-evolution image on this host to run the word inside\n'
  exit 2
fi

printf 'CE-032 — the one word, executed inside a container\n\n  image  %s\n\n' "$image"

# One disposable container, offline, removed by `--rm`. `--entrypoint sh` because the product's
# entrypoint starts the service, and this is asking a question of the image, not running it.
#
# `2>&1` and a trailing status line rather than four `docker run`s: four containers to learn
# four facts is four times the litter for no more evidence.
probe=$(docker run --rm --network none --entrypoint sh "$image" -c '
  printf "RESOLVED=%s\n" "$(command -v coden_evolution 2>/dev/null || echo NONE)"
  target=$(readlink -f /usr/local/bin/coden_evolution 2>/dev/null || echo NONE)
  printf "TARGET=%s\n" "$target"
  if [ -x "$target" ]; then printf "EXECUTABLE=yes\n"; else printf "EXECUTABLE=no\n"; fi
  help=$(coden_evolution --help 2>&1); printf "HELP_STATUS=%s\n" "$?"
  printf "HELP_MENTIONS_WORD=%s\n" "$(printf "%s" "$help" | grep -c coden_evolution || true)"
  out=$(coden_evolution 2>&1); printf "BARE_STATUS=%s\n" "$?"
  printf "BARE_SAYS_NO_SESSION=%s\n" "$(printf "%s" "$out" | grep -c "no session found" || true)"
  printf "BARE_LEAKS_TRACE=%s\n" "$(printf "%s" "$out" | grep -Ec "line [0-9]+|not found$" || true)"
' 2>&1) || true

printf '%s\n\n' "$probe"
field() { printf '%s\n' "$probe" | sed -n "s/^$1=//p" | head -n 1; }

verify 'the word resolves on PATH inside the image' "RESOLVED=$(field RESOLVED)" \
  -- equals "$(field RESOLVED)" /usr/local/bin/coden_evolution

verify 'the symlink points at the real launcher, not a dangling path' "TARGET=$(field TARGET)" \
  -- equals "$(field TARGET)" /opt/noesar/tools/coden-evolution

verify 'the launcher is executable inside the image, whatever the checkout filesystem did' "EXECUTABLE=$(field EXECUTABLE)" \
  -- equals "$(field EXECUTABLE)" yes

verify '`--help` RUNS inside the container and names the word' "status=$(field HELP_STATUS) mentions=$(field HELP_MENTIONS_WORD)" \
  -- both equals "$(field HELP_STATUS)" 0 differs "$(field HELP_MENTIONS_WORD)" 0

# The behaviour that matters most on a machine that is not this one: a container with no engine
# and no session must say so and leave, not die at a shebang and not print a shell's own error.
verify 'with no session it exits 3 and declares it, rather than failing obscurely' "status=$(field BARE_STATUS) says=$(field BARE_SAYS_NO_SESSION)" \
  -- both equals "$(field BARE_STATUS)" 3 differs "$(field BARE_SAYS_NO_SESSION)" 0

verify 'and it leaks no shell trace to the person who typed one word' "traces=$(field BARE_LEAKS_TRACE)" \
  -- equals "$(field BARE_LEAKS_TRACE)" 0

printf '\nCE032_CONTAINER_FAIL=%s\n' "$fail"
[ "$fail" = 0 ] || exit 1
