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
