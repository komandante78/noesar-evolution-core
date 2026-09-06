# SPDX-License-Identifier: AGPL-3.0-or-later
# shellcheck shell=sh
#
# Network access selection for the NOESAR Evolution installers.
#
# There is no shebang on purpose: this file is sourced, never executed, and a shebang
# would advertise otherwise. The directive above is what tells shellcheck which
# dialect to check — without it the whole file is skipped with SC2148, which is a
# check that silently analyses nothing.
#
# POSIX sh. Sourced, never executed. Read-only with respect to the host: it inspects
# the addresses already configured on this machine and does nothing else. It never
# changes routing, firewall rules, UPnP, a router, or any interface.
#
# The one decision it makes is which address the container's port is PUBLISHED on:
#
#   127.0.0.1        this server only                        (the default)
#   <a LAN address>  other machines on the local network
#   0.0.0.0          every interface, including any public one — refused unless the
#                    operator sets NOESAR_ALLOW_PUBLIC_BIND=true, because there is no
#                    TLS and no way to tell from here which interfaces are public
#
# There is deliberately no automatic path to a public interface, a VPN interface or a
# Docker bridge. An installer that quietly published a service on a WAN address would
# be a security incident, not a convenience.

NOESAR_ACCESS_CONFIG_BASENAME='network-access.json'

# Every IPv4 address configured on this host, as "<interface> <address>" lines.
noesar_host_ipv4_lines() {
  if command -v ip >/dev/null 2>&1; then
    ip -4 -o addr show 2>/dev/null | awk '{ split($4, a, "/"); print $2, a[1] }'
  elif command -v ifconfig >/dev/null 2>&1; then
    ifconfig 2>/dev/null | awk '
      /^[a-zA-Z0-9]/ { iface = $1; sub(/:$/, "", iface) }
      /inet (addr:)?[0-9]/ { addr = $2; sub(/^addr:/, "", addr); print iface, addr }'
  fi
}

noesar_address_is_on_host() {
  _target="$1"
  [ -n "$_target" ] || return 1
  # awk, not a `while read` loop: the loop body of a pipeline runs in a subshell, so
  # its `exit` sets the subshell status and the caller reads the inverse of what it
  # meant. Getting that backwards would accept an address the host does not have.
  noesar_host_ipv4_lines | awk -v target="$_target" '$2 == target { found = 1 } END { exit found ? 0 : 1 }'
}

noesar_is_loopback_address() {
  case "$1" in
    127.*|::1|localhost) return 0 ;;
    *) return 1 ;;
  esac
}

noesar_is_wildcard_address() {
  case "$1" in
    0.0.0.0|::|'*') return 0 ;;
    *) return 1 ;;
  esac
}

# RFC1918 only. A private address is the only kind this installer will ever offer.
noesar_is_private_address() {
  case "$1" in
    10.*) return 0 ;;
    192.168.*) return 0 ;;
    172.1[6-9].*|172.2[0-9].*|172.3[01].*) return 0 ;;
    *) return 1 ;;
  esac
}

# Interfaces that must never be offered as "the local network": container bridges,
# virtual machine bridges, VPN and tunnel devices, and loopback.
noesar_is_virtual_interface() {
  case "$1" in
    lo|docker*|br-*|veth*|virbr*|vmnet*|vnet*|tun*|tap*|wg*|zt*|tailscale*|ppp*|utun*)
      return 0 ;;
    *) return 1 ;;
  esac
}

# Addresses this installer is willing to propose for LAN access.
noesar_lan_candidates() {
  noesar_host_ipv4_lines | while read -r _iface _addr; do
    noesar_is_virtual_interface "$_iface" && continue
    noesar_is_loopback_address "$_addr" && continue
    noesar_is_private_address "$_addr" || continue
    printf '%s %s\n' "$_iface" "$_addr"
  done
}

noesar_first_lan_candidate() {
  noesar_lan_candidates | head -n 1 | awk '{ print $2 }'
}

# --- persistence ------------------------------------------------------------
#
# The choice belongs to the installation, not to the invocation. It is stored beside
# the other runtime configuration so that an update or a reinstall keeps answering on
# the address the Owner has bookmarked.

noesar_access_config_path() {
  printf '%s/config/%s\n' "$1" "$NOESAR_ACCESS_CONFIG_BASENAME"
}

noesar_load_access_address() {
  _file=$(noesar_access_config_path "$1")
  [ -r "$_file" ] || return 1
  _value=$(sed -n 's/.*"bindAddress"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$_file" | head -n 1)
  [ -n "$_value" ] || return 1
  printf '%s\n' "$_value"
}

noesar_load_access_mode() {
  _file=$(noesar_access_config_path "$1")
  [ -r "$_file" ] || return 1
  _value=$(sed -n 's/.*"accessMode"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$_file" | head -n 1)
  [ -n "$_value" ] || return 1
  printf '%s\n' "$_value"
}

# Written 0600 and handed to the container user: the runtime reads its own config
# directory, and a file root owns inside a 0700 directory owned by 10001 is a file
# the product cannot read.
noesar_persist_access_choice() {
  _workspace="$1"; _mode="$2"; _address="$3"; _port="$4"; _scope="$5"; _uidgid="${6:-10001:10001}"
  _file=$(noesar_access_config_path "$_workspace")
  mkdir -p "$(dirname "$_file")" || return 1
  cat > "$_file" <<EOF
{
  "accessMode": "$_mode",
  "bindAddress": "$_address",
  "bindScope": "$_scope",
  "hostPort": "$_port",
  "containerPort": "8088",
  "url": "http://$_address:$_port/",
  "note": "Written by the NOESAR Evolution installer. It records where this installation publishes its WebUI so that updates and reinstalls keep the same address. Editing it changes the default for the next install, not the running container."
}
EOF
  chmod 0600 "$_file" 2>/dev/null || true
  chown "$_uidgid" "$_file" 2>/dev/null || true
  return 0
}

# --- resolution -------------------------------------------------------------
#
# Precedence, highest first:
#   1. NOESAR_BIND_ADDRESS               explicit, scriptable, no prompt
#   2. the persisted choice              survives updates and reinstalls
#   3. an interactive prompt             only on a terminal
#   4. 127.0.0.1                         the secure default
#
# Sets NOESAR_RESOLVED_BIND_ADDRESS, NOESAR_RESOLVED_ACCESS_MODE and
# NOESAR_RESOLVED_BIND_SCOPE. It prints the menu to stderr so that a caller capturing
# stdout is unaffected.
noesar_resolve_access() {
  _workspace="$1"
  _address=''
  _mode=''

  if [ -n "${NOESAR_BIND_ADDRESS:-}" ]; then
    _address="$NOESAR_BIND_ADDRESS"
    _mode='explicit'
  elif _address=$(noesar_load_access_address "$_workspace"); then
    _mode=$(noesar_load_access_mode "$_workspace" || echo 'persisted')
    printf 'Keeping the access mode chosen for this installation: %s (%s)\n' "$_address" "$_mode" >&2
  elif [ -t 0 ] && [ -t 1 ]; then
    noesar_prompt_access_mode || return 1
    _address="$NOESAR_RESOLVED_BIND_ADDRESS"
    _mode="$NOESAR_RESOLVED_ACCESS_MODE"
  else
    # No terminal, nothing configured, nothing remembered: choose the answer that
    # cannot expose anything. A non-interactive install is never silently widened.
    _address='127.0.0.1'
    _mode='local-server-only'
  fi

  noesar_validate_bind_address "$_address" || return 1

  # These three are this function's return values. They are read by the installer that
  # sourced this file, which shellcheck cannot see from here.
  # shellcheck disable=SC2034
  NOESAR_RESOLVED_BIND_ADDRESS="$_address"
  # shellcheck disable=SC2034
  NOESAR_RESOLVED_ACCESS_MODE="$_mode"
  if noesar_is_loopback_address "$_address"; then
    # shellcheck disable=SC2034
    NOESAR_RESOLVED_BIND_SCOPE='loopback'
  elif noesar_is_wildcard_address "$_address"; then
    # shellcheck disable=SC2034
    NOESAR_RESOLVED_BIND_SCOPE='custom'
  else
    # shellcheck disable=SC2034
    NOESAR_RESOLVED_BIND_SCOPE='lan'
  fi
  return 0
}

noesar_validate_bind_address() {
  _address="$1"

  if [ -z "$_address" ]; then
    echo "Access mode: no bind address resolved." >&2
    return 1
  fi

  if noesar_is_wildcard_address "$_address"; then
    if [ "${NOESAR_ALLOW_PUBLIC_BIND:-false}" != 'true' ]; then
      cat >&2 <<'EOF'
Refusing to publish on 0.0.0.0.

That binds every interface on this machine, including any interface facing the
internet, and NOESAR ships without TLS. Choose the address you actually want:

  NOESAR_BIND_ADDRESS=127.0.0.1        this server only
  NOESAR_BIND_ADDRESS=<your LAN IP>    the local network

If binding every interface is genuinely what you want, and you have put TLS and an
access control layer in front of it, set NOESAR_ALLOW_PUBLIC_BIND=true as well.
EOF
      return 1
    fi
    echo "WARNING: publishing on $_address — every interface, including public ones. NOESAR_ALLOW_PUBLIC_BIND=true was set explicitly." >&2
    return 0
  fi

  if noesar_is_loopback_address "$_address"; then
    return 0
  fi

  if ! noesar_address_is_on_host "$_address"; then
    {
      printf 'Refusing to publish on %s: no interface on this host carries that address.\n\n' "$_address"
      printf 'Docker would reject the publish at run time, or worse, accept it and answer nowhere.\n'
      printf 'Addresses available on this host:\n'
      noesar_host_ipv4_lines | while read -r _iface _addr; do
        printf '  %-12s %s\n' "$_iface" "$_addr"
      done
    } >&2
    return 1
  fi

  if ! noesar_is_private_address "$_address"; then
    if [ "${NOESAR_ALLOW_PUBLIC_BIND:-false}" != 'true' ]; then
      printf 'Refusing to publish on %s: it is not a private (RFC1918) address.\n' "$_address" >&2
      printf 'NOESAR ships without TLS. Set NOESAR_ALLOW_PUBLIC_BIND=true to override.\n' >&2
      return 1
    fi
    printf 'WARNING: %s is not a private address and NOESAR has no TLS.\n' "$_address" >&2
  fi
  return 0
}

noesar_prompt_access_mode() {
  _default_lan=$(noesar_first_lan_candidate)
  {
    echo
    echo 'Access mode:'
    echo '1. Local server only'
    echo '2. Local network'
    echo '3. Custom interface'
    echo
  } >&2

  printf 'Choice [1]: ' >&2
  read -r _choice || _choice=''
  [ -n "$_choice" ] || _choice=1

  case "$_choice" in
    1)
      NOESAR_RESOLVED_BIND_ADDRESS='127.0.0.1'
      NOESAR_RESOLVED_ACCESS_MODE='local-server-only'
      ;;
    2)
      if [ -z "$_default_lan" ]; then
        echo 'No local-network address was found on this host. Use option 3 and name one.' >&2
        return 1
      fi
      _count=$(noesar_lan_candidates | wc -l | tr -d ' ')
      if [ "$_count" -gt 1 ]; then
        echo 'Local network addresses on this host:' >&2
        noesar_lan_candidates | while read -r _iface _addr; do
          printf '  %-12s %s\n' "$_iface" "$_addr" >&2
        done
        printf 'Address [%s]: ' "$_default_lan" >&2
        read -r _picked || _picked=''
        [ -n "$_picked" ] || _picked="$_default_lan"
      else
        _picked="$_default_lan"
      fi
      NOESAR_RESOLVED_BIND_ADDRESS="$_picked"
      NOESAR_RESOLVED_ACCESS_MODE='local-network'
      ;;
    3)
      printf 'Address to publish on: ' >&2
      read -r _picked || _picked=''
      NOESAR_RESOLVED_BIND_ADDRESS="$_picked"
      NOESAR_RESOLVED_ACCESS_MODE='custom-interface'
      ;;
    *)
      echo "Unrecognised choice: $_choice" >&2
      return 1
      ;;
  esac

  printf 'Selected address: %s\n' "$NOESAR_RESOLVED_BIND_ADDRESS" >&2
  return 0
}

# The address to probe for readiness after the container starts. Publishing on a LAN
# address means 127.0.0.1 does NOT answer, so a health loop that always probes
# loopback reports a failed installation that in fact succeeded.
noesar_probe_address() {
  if noesar_is_wildcard_address "$1"; then
    printf '127.0.0.1\n'
  else
    printf '%s\n' "$1"
  fi
}

# --- the guided screen ------------------------------------------------------
#
# The notices, the port and the acknowledgement, in the one file every POSIX installer
# already sources. Three installers call `noesar_install_intro` and get the identical
# screen; Windows prints the SAME text file from PowerShell. A welcome screen written
# twice is a screen that says two different things within a month — this project has
# already paid for that shape with "the five archives".
#
# What is deliberately NOT here: anything that changes the host. This asks, records the
# answers beside the access choice, and returns them. It installs nothing.

NOESAR_CONSENT_CONFIG_BASENAME='install-consent.json'
NOESAR_DEFAULT_USERNAME='root'
NOESAR_DEFAULT_PASSWORD='noesar'

noesar_consent_config_path() {
  printf '%s/config/%s\n' "$1" "$NOESAR_CONSENT_CONFIG_BASENAME"
}

# Printed to stderr, like the access menu above it, so a caller capturing stdout for a
# machine-readable line still shows the human the notices.
noesar_print_welcome() {
  _welcome="$1/INSTALLATION/WELCOME.txt"
  if [ ! -r "$_welcome" ]; then
    printf 'The installation notices are missing from this tree: %s\n' "$_welcome" >&2
    printf 'Refusing to install silently what the notices exist to say out loud.\n' >&2
    return 1
  fi
  cat "$_welcome" >&2
}

# Acknowledged once per installation, then remembered — an update should not re-ask.
#
# A machine is not a person: with no terminal there is nobody to acknowledge anything,
# so the notices are printed, the install proceeds, and the record says plainly that no
# human acknowledged them. Refusing instead would break every unattended install and
# every acceptance run, and a consent nobody read is worth nothing anyway; what matters
# is that the file never claims a person accepted when none did.
noesar_take_consent() {
  _workspace="$1"
  _file=$(noesar_consent_config_path "$_workspace")

  if [ -r "$_file" ]; then
    printf '\nThe notices were acknowledged for this installation already (%s).\n' "$_file" >&2
    return 0
  fi

  if [ "${NOESAR_ACCEPT_NOTICES:-}" = 'true' ]; then
    _by='NOESAR_ACCEPT_NOTICES=true was set by the caller'
  elif [ -t 0 ] && [ -t 1 ]; then
    printf '\nType "accept" if you have read the five points above (anything else stops here): ' >&2
    read -r _answer || _answer=''
    case "$_answer" in
      accept|Accept|ACCEPT|accetto|Accetto|ACCETTO)
        _by='typed at the installer prompt' ;;
      *)
        printf 'Not accepted. Nothing has been installed.\n' >&2
        return 1 ;;
    esac
  else
    _by='NOT acknowledged by a person: no terminal, notices printed to the log only'
    printf '\nNo terminal to ask on. The notices above were printed, not acknowledged.\n' >&2
  fi

  mkdir -p "$(dirname "$_file")" || return 1
  cat > "$_file" <<EOF
{
  "notices": "INSTALLATION/WELCOME.txt",
  "acknowledgedAt": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "acknowledgedBy": "$_by",
  "note": "Written by the NOESAR Evolution installer. Delete this file to be shown the notices again on the next install."
}
EOF
  chmod 0600 "$_file" 2>/dev/null || true
  return 0
}

noesar_load_access_port() {
  _file=$(noesar_access_config_path "$1")
  [ -r "$_file" ] || return 1
  _value=$(sed -n 's/.*"hostPort"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$_file" | head -n 1)
  [ -n "$_value" ] || return 1
  printf '%s\n' "$_value"
}

noesar_port_is_valid() {
  case "$1" in
    ''|*[!0-9]*) return 1 ;;
  esac
  [ "$1" -ge 1 ] && [ "$1" -le 65535 ]
}

# Best effort, and it says so: a busy port is reported as advice, never as a refusal.
# `ss` and `netstat` see only what this user is allowed to see, and neither exists on
# every host — an installer that refused on their silence would refuse for the wrong
# reason. Returns 1 (not busy / cannot tell) unless it positively saw the port taken.
noesar_port_is_busy() {
  if command -v ss >/dev/null 2>&1; then
    ss -ltn 2>/dev/null | awk -v p=":$1\$" '$4 ~ p { found = 1 } END { exit found ? 0 : 1 }'
  elif command -v netstat >/dev/null 2>&1; then
    netstat -ltn 2>/dev/null | awk -v p=":$1\$" '$4 ~ p { found = 1 } END { exit found ? 0 : 1 }'
  else
    return 1
  fi
}

# Precedence mirrors noesar_resolve_access exactly: explicit env, then the choice this
# installation already made, then a prompt, then the default. Sets NOESAR_RESOLVED_PORT.
noesar_resolve_port() {
  _workspace="$1"
  _default="${2:-8088}"

  if [ -n "${NOESAR_PORT:-}" ]; then
    # shellcheck disable=SC2034
    NOESAR_RESOLVED_PORT="$NOESAR_PORT"
    noesar_port_is_valid "$NOESAR_RESOLVED_PORT" || {
      printf 'NOESAR_PORT=%s is not a port number between 1 and 65535.\n' "$NOESAR_PORT" >&2
      return 1
    }
    return 0
  fi

  if _saved=$(noesar_load_access_port "$_workspace"); then
    _default="$_saved"
  fi

  if [ ! -t 0 ] || [ ! -t 1 ]; then
    NOESAR_RESOLVED_PORT="$_default"
    return 0
  fi

  while :; do
    printf '\nPort to publish the WebUI on [%s]: ' "$_default" >&2
    read -r _port || _port=''
    [ -n "$_port" ] || _port="$_default"
    if ! noesar_port_is_valid "$_port"; then
      printf '  %s is not a port number between 1 and 65535.\n' "$_port" >&2
      continue
    fi
    if noesar_port_is_busy "$_port"; then
      printf '  Port %s already has something listening on it.\n' "$_port" >&2
      printf '  Continue anyway? The container will fail to start if it is really taken. [y/N]: ' >&2
      read -r _anyway || _anyway=''
      case "$_anyway" in y|Y|yes|YES) ;; *) continue ;; esac
    fi
    NOESAR_RESOLVED_PORT="$_port"
    printf 'Selected port: %s\n' "$NOESAR_RESOLVED_PORT" >&2
    return 0
  done
}

# The whole screen, in the order a person meets it: read, acknowledge, choose the port.
# The access mode stays where it already lived (noesar_resolve_access), so an installer
# that has not adopted this screen keeps working exactly as before.
noesar_install_intro() {
  _workspace="$1"
  _root="$2"
  _default_port="${3:-8088}"
  noesar_print_welcome "$_root" || return 1
  noesar_take_consent "$_workspace" || return 1
  noesar_resolve_port "$_workspace" "$_default_port" || return 1
  return 0
}

# Printed where the installer already prints the URL. The credentials are in WELCOME.txt
# too, but that was several screens and one container build ago: the moment a person can
# actually sign in is the moment this has to be in front of them.
noesar_print_first_signin() {
  cat <<EOF

  Sign in with:      username  $NOESAR_DEFAULT_USERNAME
                     password  $NOESAR_DEFAULT_PASSWORD

  This password is the same on every installation of NOESAR Evolution in the
  world. CHANGE IT NOW, at the first sign-in: Settings -> change password.
  A banner stays across the top of the product until you do.

EOF
}

# The workspace has to belong to the uid the container runs as — the first defect a
# from-clone installation hits, and it hits it 20 seconds in, as a stack trace.
#
# Every installer here creates the workspace as the person running the installer (root,
# normally) with mode 0700, and then starts the container with `--user 10001:10001`. A
# 0700 directory owned by root is unreadable and unwritable to uid 10001, so the runtime
# dies on `mkdir '/workspace/audit'` (AuditLedger's constructor) and on
# `mkdir '/workspace/postgresql/data'`, restarts five times, and the installation ends
# "unhealthy" with nothing saying why. Measured on a clean Ubuntu host, 2026-09-06.
#
# The product cannot repair this from the inside: it is already running as 10001 by the
# time it finds out. The installer is the only place that still has the privilege to fix
# it, so it is the installer's job. `noesar_persist_access_choice` below has been doing
# exactly this chown for its own file all along — the directory was simply never given
# the same treatment.
noesar_prepare_workspace() {
  _workspace="$1"
  _uidgid="${2:-10001:10001}"
  _uid=${_uidgid%%:*}

  mkdir -p "$_workspace" || return 1
  chmod 0700 "$_workspace" || return 1

  chown "$_uidgid" "$_workspace" 2>/dev/null && return 0

  # chown failed. Harmless if the directory is already the container user's — which is
  # the normal case for an unprivileged install, where they are the same person.
  if [ "$(id -u)" = "$_uid" ]; then
    return 0
  fi

  cat >&2 <<EOF
Cannot hand the workspace to the account the product runs as.

  workspace   $_workspace
  owned by    uid $(id -u "$(stat -c %U "$_workspace" 2>/dev/null)" 2>/dev/null || stat -c %u "$_workspace" 2>/dev/null || echo '?')
  needs       uid $_uid

The container runs as $_uidgid and would fail on its first write, several seconds
after this installer reported success. Stopping here instead.

Either run this installer as root, or start the container as the account that owns
the workspace:  NOESAR_RUN_AS=$(id -u):$(id -g)
EOF
  return 1
}
