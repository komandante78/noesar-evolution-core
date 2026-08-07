#!/usr/bin/env sh
# SPDX-License-Identifier: AGPL-3.0-or-later
#
# install-coden-cli — put `coden_evolution` on this account's PATH. One command, no root.
#
# WHY THIS FILE EXISTS. Until it did, an installation that came as a container image had
# exactly one documented entrance: MASTER_PROJECT/08_INSTALLAZIONE.md §12 — a system user,
# a sudoers rule, an edit to sshd_config, the host's real Port and ListenAddress, and on
# hosts whose root filesystem lives in RAM a boot-persistence mechanism as well. Six steps
# and three traps, all of them as the administrator of the machine, and the Windows half
# declared UNVERIFIED. That is a maintainer's entrance. A self-hosted product has to open
# on whatever the person already has.
#
# And the entrance was there the whole time: `elevate` is EMPTY by default in the launcher,
# so an account that can already talk to its own container engine — which is every account
# that just deployed the container — needs no sudoers rule and no sshd rule to reach the
# session. The only thing missing was that nothing put the launcher on the host. §12 step 1
# made a human run `docker create`, `docker cp`, `docker rm` and `chmod`, plus know the image
# tag: the same three-concepts problem the launcher exists to abolish, moved one floor up.
# This file is that floor.
#
# WHAT IT IS NOT ALLOWED TO DO — the same law the launcher lives under (16 §4.3):
#
#   * It never needs root, and never asks for it. If it cannot do something as this account,
#     it says so and stops; it does not escalate.
#   * It never adds anyone to the container engine's group. That group is administration of
#     the machine (trap 2), and a shell of the product is not worth the host.
#   * It never edits sshd, sudoers, a unit file or a group. It writes inside this account's
#     own home directory and nowhere else, and it refuses a destination outside it unless a
#     human named that destination on the command line.
#   * It never publishes the session socket on the host. It installs the thing that goes to
#     the socket; it does not move the socket.
#
# HOW IT FINDS WHAT TO INSTALL — the same discovery law as the launcher, deliberately:
# an engine is used because it ANSWERS, not because it is on PATH, and the container is
# found by the product LABEL, never by a name anybody had to memorise. Two matches are
# named, not silently resolved. Reusing the law matters more than reusing the code here:
# the two files run at different moments (this one before the launcher exists) and sharing
# an implementation would mean shipping a third file to bootstrap the second.
set -eu

PROGRAM_NAME=install-coden-cli
EXIT_USAGE=2
EXIT_NO_SESSION=3
EXIT_AMBIGUOUS=4

DISCOVERY_LABEL='org.noesar.authority=reference-node'
REMOTE_LAUNCHER=/opt/noesar/tools/coden-evolution
INSTALLED_NAME=coden_evolution

say() { printf '%s: %s\n' "$PROGRAM_NAME" "$1" >&2; }

usage() {
  cat >&2 <<USAGE
$PROGRAM_NAME — put \`$INSTALLED_NAME\` on this account's PATH.

  $PROGRAM_NAME                    find the running installation and install the word
  $PROGRAM_NAME --bin-dir DIR      install somewhere other than \${XDG_BIN_HOME:-\$HOME/.local/bin}
  $PROGRAM_NAME --engine NAME      skip engine discovery (docker, podman, nerdctl, ...)
  $PROGRAM_NAME --container NAME   name the installation, when the host runs more than one
  $PROGRAM_NAME --no-path          do not offer to put the directory on PATH
  $PROGRAM_NAME --uninstall        remove what this installer wrote, and say what it left

Root is never required and never requested. Nothing outside your home directory is written
unless you name a destination yourself.
USAGE
}

bin_dir=
bin_dir_explicit=no
opt_engine=
opt_container=
touch_path=yes
mode=install

while [ "$#" -gt 0 ]; do
  case $1 in
    -h|--help|help) usage; exit 0 ;;
    --bin-dir)   [ "$#" -ge 2 ] || { say "--bin-dir needs a directory"; exit "$EXIT_USAGE"; }
                 bin_dir=$2; bin_dir_explicit=yes; shift 2 ;;
    --engine)    [ "$#" -ge 2 ] || { say "--engine needs a name"; exit "$EXIT_USAGE"; }
                 opt_engine=$2; shift 2 ;;
    --container) [ "$#" -ge 2 ] || { say "--container needs a name"; exit "$EXIT_USAGE"; }
                 opt_container=$2; shift 2 ;;
    --no-path)   touch_path=no; shift ;;
    --uninstall) mode=uninstall; shift ;;
    *) say "unknown argument '$1'"; usage; exit "$EXIT_USAGE" ;;
  esac
done

# ---------------------------------------------------------------------------------------
# Where it goes. XDG_BIN_HOME first, then ~/.local/bin — the same pair
# deployment/linux/install-portable.sh already uses, because a product that installs itself
# into two different places on one machine is a product with two uninstall procedures.
# ---------------------------------------------------------------------------------------
if [ -z "$bin_dir" ]; then
  bin_dir=${XDG_BIN_HOME:-${HOME:-}/.local/bin}
fi

if [ -z "${HOME:-}" ] && [ "$bin_dir_explicit" = no ]; then
  say "HOME is not set, so there is no home directory to install into."
  say "name a destination explicitly: $PROGRAM_NAME --bin-dir /some/directory"
  exit "$EXIT_USAGE"
fi

# The guard, and the reason it is not paranoia. This installer is the first thing that runs
# on an installation, often pasted from a page, sometimes as root because that is the only
# account a NAS appliance offers. A default destination that resolved outside the home
# directory would then write into system paths that nobody asked it to touch. So the
# default is required to stay inside $HOME, and the ONLY way out is a human typing
# --bin-dir. Resolved with `cd` rather than string comparison so that a symlinked or
# relative path cannot walk past the check.
if [ "$bin_dir_explicit" = no ]; then
  home_resolved=$(CDPATH= cd -- "$HOME" 2>/dev/null && pwd) || {
    say "HOME is set to '$HOME' but that is not a directory this account can enter"
    exit "$EXIT_USAGE"
  }
  case $bin_dir in
    "$home_resolved"|"$home_resolved"/*) ;;
    *) say "refusing to install to '$bin_dir', which is outside $home_resolved."
       say "if you meant it, say so: $PROGRAM_NAME --bin-dir '$bin_dir'"
       exit "$EXIT_USAGE" ;;
  esac
fi

destination=$bin_dir/$INSTALLED_NAME

# ---------------------------------------------------------------------------------------
# Uninstall. It removes what this file wrote and NAMES what it did not, because the thing
# an uninstaller must never do is imply it undid more than it did: the PATH line in a shell
# profile and anything §12 installed on the host are not ours to take back silently.
# ---------------------------------------------------------------------------------------
if [ "$mode" = uninstall ]; then
  if [ -e "$destination" ]; then
    rm -f "$destination" && say "removed $destination"
  else
    say "nothing to remove at $destination"
  fi
  say "left alone: any PATH line in your shell profile, and anything the optional ssh"
  say "recipe (08_INSTALLAZIONE §12) installed on the host — neither was written by this file"
  exit 0
fi

# ---------------------------------------------------------------------------------------
# The engine. Installed is not the same as working: a `docker` shim with no daemon behind
# it is ordinary on a host where the engine was removed, or is rootless and not running,
# and treating "on PATH" as "present" turns a clear failure into a confusing one. So each
# candidate must ANSWER `version` before it is used.
# ---------------------------------------------------------------------------------------
attempts=
note_attempt() {
  if [ -z "$attempts" ]; then attempts="  - $1"; else attempts="$attempts
  - $1"; fi
}

if [ -n "$opt_engine" ]; then
  engine_candidates=$opt_engine
else
  engine_candidates="docker podman nerdctl"
fi

engine=
for engine_candidate in $engine_candidates; do
  engine_bin=$(command -v "$engine_candidate" 2>/dev/null || printf '%s' "$engine_candidate")
  [ -x "$engine_bin" ] || { note_attempt "'$engine_candidate' is not on PATH"; continue; }
  if "$engine_bin" version >/dev/null 2>&1; then
    engine=$engine_bin
    break
  fi
  note_attempt "'$engine_candidate' is installed but did not answer (daemon down, or this account may not talk to it)"
done

if [ -z "$engine" ]; then
  say "no container engine answered, so there is nothing to install from."
  printf '%s\n' "$attempts" >&2
  say ""
  say "if the installation runs on ANOTHER machine, you do not need this file at all:"
  say "open http://<that-machine>:8100/ in a browser. That works on every operating"
  say "system, needs nothing installed, and is the same session."
  exit "$EXIT_NO_SESSION"
fi

# ---------------------------------------------------------------------------------------
# The installation to install from — found by the label the image already carries.
# ---------------------------------------------------------------------------------------
if [ -n "$opt_container" ]; then
  container=$opt_container
else
  container=$("$engine" ps --filter "label=$DISCOVERY_LABEL" --filter 'status=running' \
    --format '{{.Names}}' 2>/dev/null || true)
fi

if [ -z "$container" ]; then
  say "'$engine' answered, but no running container carries the label $DISCOVERY_LABEL."
  say "start the installation first, then run this again."
  exit "$EXIT_NO_SESSION"
fi

# Counted with shell builtins, and more than one match is NOT resolved by taking the first.
# Guessing which installation an operator meant is the class of silent choice this project
# keeps finding in its own postmortems.
container_count=0
container_first=
while IFS= read -r container_line; do
  [ -n "$container_line" ] || continue
  container_count=$((container_count + 1))
  [ -n "$container_first" ] || container_first=$container_line
done <<MATCHES
$container
MATCHES

if [ "$container_count" -gt 1 ]; then
  say "more than one running installation matched:"
  while IFS= read -r container_line; do
    [ -n "$container_line" ] || continue
    printf '  - %s\n' "$container_line" >&2
  done <<MATCHES
$container
MATCHES
  say "name the one you mean: $PROGRAM_NAME --container <name>"
  exit "$EXIT_AMBIGUOUS"
fi
container=$container_first

# ---------------------------------------------------------------------------------------
# Take the launcher out of the running installation, and check it before believing it.
#
# Written to a temporary file first and moved into place only after it has been inspected
# AND executed. A half-written file on PATH under the name of the product is worse than no
# file at all: it fails in a way that looks like the product is broken.
# ---------------------------------------------------------------------------------------
mkdir -p "$bin_dir" || {
  say "cannot create $bin_dir"
  exit "$EXIT_NO_SESSION"
}

staged=$destination.incoming.$$
cleanup() { rm -f "$staged"; }
trap cleanup EXIT INT TERM

if ! "$engine" cp "$container:$REMOTE_LAUNCHER" "$staged" >/dev/null 2>&1; then
  say "'$engine' could not copy $REMOTE_LAUNCHER out of '$container'."
  say "that path is where the image ships the launcher; an image older than 2026-08-07 may not have it."
  exit "$EXIT_NO_SESSION"
fi

[ -s "$staged" ] || { say "what came out of '$container' is empty; refusing to install it"; exit "$EXIT_NO_SESSION"; }

# It has to be a script, and it has to be THIS script. `head -1` is avoided on purpose --
# this file runs before anything is installed, on hosts smaller than the one it was written
# on, so it reads the first line with the shell itself.
IFS= read -r first_line < "$staged" || first_line=
case $first_line in
  '#!'*) ;;
  *) say "what came out of '$container' does not begin with a #! line; refusing to install it"
     exit "$EXIT_NO_SESSION" ;;
esac

if ! grep -q 'coden_evolution' "$staged" 2>/dev/null; then
  say "what came out of '$container' does not look like the launcher; refusing to install it"
  exit "$EXIT_NO_SESSION"
fi

chmod 0755 "$staged"

# Executed before it is trusted. `--help` is the one argument the launcher accepts, it
# reaches no engine and opens no session, and a file that cannot even print its own usage
# is not one to leave on PATH under the product's name.
if ! "$staged" --help >/dev/null 2>&1; then
  say "the launcher taken from '$container' could not run here (\`--help\` failed)."
  say "this usually means /bin/sh on this host is not what the launcher expects; nothing was installed."
  exit "$EXIT_NO_SESSION"
fi

mv -f "$staged" "$destination"
trap - EXIT INT TERM

# ---------------------------------------------------------------------------------------
# PATH. The chore this installer exists to remove, so it is not left as a chore -- but it
# is left VISIBLE: the line that was added is printed, with the file it went into, because
# a program that edits a shell profile without saying so is a program you find out about
# later. Only ~/.profile is touched: it is POSIX, it is read by sh, bash and zsh login
# shells, and appending to every rc file a machine might have is how an installer starts
# owning a shell configuration it did not write.
# ---------------------------------------------------------------------------------------
path_has_bin_dir=no
case ":${PATH:-}:" in
  *":$bin_dir:"*) path_has_bin_dir=yes ;;
esac

path_note=
if [ "$path_has_bin_dir" = no ] && [ "$touch_path" = yes ] && [ -n "${HOME:-}" ]; then
  profile=$HOME/.profile
  marker='# NOESAR_EVOLUTION_PATH'
  if [ -f "$profile" ] && grep -qF "$marker" "$profile" 2>/dev/null; then
    path_note="already declared in $profile (open a new shell to pick it up)"
  else
    {
      printf '\n%s -- added by %s\n' "$marker" "$PROGRAM_NAME"
      printf 'case ":$PATH:" in *":%s:"*) ;; *) PATH="%s:$PATH" ;; esac\n' "$bin_dir" "$bin_dir"
    } >> "$profile" && path_note="added to $profile (open a new shell, or run: . $profile)"
  fi
elif [ "$path_has_bin_dir" = no ]; then
  path_note="NOT on your PATH -- add it yourself, or run this again without --no-path"
fi

# ---------------------------------------------------------------------------------------
# What to say at the end. The browser is named FIRST and unconditionally, because it is the
# access that costs nothing on every operating system including the ones this file cannot
# run on, and because a person reading this has just proved they have a terminal -- which
# is exactly the person who never gets told there was an easier way.
# ---------------------------------------------------------------------------------------
published=$("$engine" port "$container" 2>/dev/null | sed -n 's/^8100\/tcp -> //p' | head -1 || true)
[ -n "$published" ] || published=$("$engine" port "$container" 2>/dev/null | sed -n 's/^.*-> //p' | head -1 || true)

printf '\n'
printf 'Installed: %s\n' "$destination"
printf 'Taken from: %s (found by label, not by name)\n' "$container"
if [ -n "$path_note" ]; then
  printf 'PATH: %s\n' "$path_note"
fi
printf '\n'
printf 'Open the session by typing one word:\n'
printf '\n'
printf '    %s\n' "$INSTALLED_NAME"
printf '\n'
printf 'Or open it in a browser -- nothing to install, any operating system, any device:\n'
printf '\n'
if [ -n "$published" ]; then
  printf '    http://%s/\n' "$published"
else
  printf '    http://<this-host>:8100/\n'
fi
printf '\n'
printf 'Either way you are asked to authenticate after you are in, not before you can start.\n'
