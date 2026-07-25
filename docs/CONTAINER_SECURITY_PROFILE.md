# Container Security Profile

The exact runtime posture of the installed container, and why each choice was made.

## Observed configuration

| Control | Value | Verified |
|---|---|---|
| user | `10001:10001` (non-root) | `id` inside the container returns `uid=10001 gid=10001` |
| root filesystem | read-only | writes to `/opt/noesar` and `/etc` refused |
| capabilities | `--cap-drop=ALL`, none added | `CapDrop=[ALL] CapAdd=[]` |
| privilege escalation | `no-new-privileges:true` | `SecurityOpt=[no-new-privileges:true]` |
| seccomp | **Docker builtin** (deny-by-default allowlist) | no `seccomp=` in `SecurityOpt` |
| AppArmor / SELinux | absent on this host | seccomp is the only MAC layer |
| memory | 8 GiB | `memory.max = 8589934592` |
| swap | see limits below | `memory.swap.max = max`; host swap total is 0 |
| cpu | 4 cores | `cpu.max = 400000 100000` |
| pids | 512 | `pids.max = 512` |
| tmpfs | `/tmp` 128 M, `/run` 16 M, both `rw,nosuid,nodev,noexec` | executing from `/tmp` is denied |
| network | `noesar-evolution-net` (dedicated bridge) | not `noesar-local` |
| published port | `127.0.0.1:8100 → 8088` | LAN probe to the host IP is refused |
| Docker socket | not mounted | 0 socket mounts |
| mounts | one bind: `RUNTIME_ROOT → /workspace` | nothing else |
| restart policy | `unless-stopped` | |
| GPU | not allocated | reported as `allocated: false` |

## The seccomp decision

`security/seccomp-noesar.json` ships with:

```json
{ "defaultAction": "SCMP_ACT_ALLOW", "syscalls": [ { "names": [ …24 names… ], "action": "SCMP_ACT_ERRNO" } ] }
```

That is **allow-by-default with a 24-syscall denylist**. Passing it via
`--security-opt seccomp=` does not add it to Docker's builtin profile — it **replaces**
it. Docker's builtin is deny-by-default over an allowlist of roughly 350 syscalls and
already blocks all 24 of those and many more. Using the shipped file therefore makes the
sandbox weaker, on a host that has neither AppArmor nor SELinux.

**Decision (D-0024, enforced in Phase 3):** never pass `--security-opt seccomp=`.

Three things enforce it now, rather than one note in a document:

1. the file itself carries `"x-noesar-status": "NOT_FOR_USE"` with the reason, at the top
   of its own body (Docker's JSON decoder ignores unknown fields, so the file remains a
   valid profile if anyone ever does load it);
2. all three delivered installers had the flag removed — they really were passing it,
   which Phase 2 did not notice;
3. `tools/test-installer-hardening.mjs` runs each installer against a stub `docker` and
   fails if `seccomp=` reappears, or if any other hardening flag stops arriving.

Replacing it with a genuine derived allowlist was considered and rejected: Docker's
builtin is already a tested deny-by-default allowlist, and a hand-written substitute
would be strictly more risk for no gain.

## Limits: what did not take effect

`--memory-swap=8g` was requested and **not applied**. Docker printed
`WARNING: Your kernel does not support swap limit capabilities or the cgroup is not
mounted`, and `/sys/fs/cgroup/memory.swap.max` reads `max`.

This is stated rather than glossed: the intended effect — no swap spill — holds anyway,
because the host has **zero swap configured** (`swap_total_bytes = 0`). If swap is ever
added to this host, the container would be able to use it until swap accounting is
enabled in the kernel cgroup configuration.

## What this profile does not cover

- **TLS.** Nothing is published beyond loopback, so there is no transport to protect.
  If the port is ever exposed, TLS must terminate at a reverse proxy **and**
  `NOESAR_SECURE_COOKIES=true` must be set.
- **Runtime file-integrity monitoring.** `MANIFEST.sha256` covers the repository, not the
  running container.
- **Adversarial testing.** Phase 4.
