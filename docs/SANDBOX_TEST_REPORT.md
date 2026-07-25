# Phase 4 — sandbox test report

20 checks against a live container running `noesar-evolution:phase4` with the installation's
own flags. **20 PASS, 0 FAIL.** Every result is an observation from inside the sandbox, not
an inference from the run command: these properties are invisible to every static analyser
on this host, because a read-only rootfs and an empty capability set are runtime facts.

Driver: `tools/acceptance/a4-container-sandbox.sh`. Full evidence:
`docs/ACCEPTANCE_RESULTS.tsv`, section `SBX`.

## Identity and privilege

| # | Check | Observed |
|---|---|---|
| SBX-01 | non-root | `uid=10001(noesar) gid=10001(noesar) groups=10001(noesar)` |
| SBX-02 | no-new-privileges | `/proc/1/status`: `NoNewPrivs: 1` |
| SBX-03 | capabilities dropped | `CapEff: 0000000000000000` — nothing added back |
| SBX-17 | escalation to root | `su root -c id` → `su: Authentication failure` |
| SBX-16 | setuid binaries in the image | `chfn chsh gpasswd mount newgrp` present, and inert: with an empty capability set and `NoNewPrivs`, a setuid-root binary cannot transition |

## seccomp

`SBX-04`: `/proc/1/status` reports `Seccomp: 2` (`SECCOMP_MODE_FILTER`) with
`Seccomp_filters: 1`, and `HostConfig.SecurityOpt` is `[no-new-privileges:true]` with **no**
profile override. Docker's builtin deny-by-default profile is therefore in force.

This is the F-002 fix from Phase 3 confirmed at runtime rather than in the installer text:
the delivered scripts used to pass `security/seccomp-noesar.json`, which is
`defaultAction: SCMP_ACT_ALLOW` with a 24-syscall denylist and **replaces** the builtin
allowlist. On a host with neither AppArmor nor SELinux — this one — that made the sandbox
weaker, not stronger. Two syscall probes confirm the builtin is doing its job:

```text
SBX-18  mount -t proc proc /mnt              -> must be superuser to use mount (rc=32)
SBX-19  unshare --user --map-root-user id    -> unshare failed: Operation not permitted
```

Phase 3's regression guard for this defect also fired during Phase 4 — on this very report's
driver script, because an evidence string put `seccomp=` and the profile filename on one
line. The script was reworded; the guard was left exactly as sharp as it was.

## Filesystem

| # | Check | Observed |
|---|---|---|
| SBX-05 | root filesystem read-only | `/`: Read-only file system · `/opt/noesar`: Read-only file system · `/etc/passwd`: Permission denied |
| SBX-06 | no execution from tmpfs | wrote `/tmp/probe.sh`, `chmod +x`, ran it → `Permission denied (rc=126)`; `/tmp` and `/run` are both `noexec,nosuid,nodev` |
| SBX-07 | workspace writable | write + remove in `/workspace` → rc=0, the single writable product path |
| SBX-12 | temporary disk bounded | 200 MiB write into `/tmp` stopped at 128 MiB, the tmpfs size |
| SBX-15 | symlink escape | `/workspace/.escape-link -> /etc/shadow` reads `Permission denied`, and that is the container's own `/etc/shadow`: the host filesystem is not mounted |

## Host exposure

- `SBX-08` — `/var/run/docker.sock`: **No such file or directory**. No agent, tool or MCP
  server has any path to the Docker API.
- `SBX-09` — exactly **one** mount: the workspace bind. `/host` and `/code` do not exist
  inside the container and `/mnt` is empty.
- `SBX-13` — published on `127.0.0.1:8101` for the probe (`127.0.0.1:8100` for the
  installation). Loopback answers 200; the LAN address `192.168.178.100` is **refused**.

## Resource limits

`SBX-10` reads the limits from the kernel, not from the run command: cgroup
`pids.max=512`, `memory.max=2147483648`. `SBX-11` then spawns 900 long-lived shells against
that limit and the kernel refuses — `sh: 0: Cannot fork` — while the container stays
`running` and `/livez` keeps answering 200.

Two notes on how that test had to be written. First, it runs **last**: the spawned shells
hold pids-cgroup slots for their lifetime, so on the first attempt every check placed after
it failed to fork and reported a false negative. Ordering, not a drain timer, is the fix.
Second, the earlier version used `sleep 0.05`, so the processes exited as fast as they were
created and never accumulated to the cap — a test that passed without testing anything.

`--memory-swap` still has no effect on this host: the kernel lacks swap accounting. The host
has zero swap, so the intended outcome holds anyway. Stated, not glossed.

## Egress — recorded rather than claimed

`SBX-14`: name resolution from inside the container **succeeds**
(`getent hosts example.com` returns addresses). Egress is *not* blocked at the network
layer. What prevents provider traffic is the product's own consent gate, verified separately
and specifically: SEC-39 shows an enabled-but-unconsented external provider refused by
`#assertAllowed()` before any connection is attempted, and SEC-40 shows that with consent
and a credential the request *does* reach the network layer and fails on DNS — proving the
gate, not a lack of capability, is what stops it.

Recording this as an observation rather than as a sandbox guarantee is deliberate. An
operator who wants network-level egress control has to add it; this container does not
provide it.

## One expected exposure

`SBX-20`: `/proc/1/environ` is readable from inside the container, because the process is
pid 1 and owned by the same uid. That is exactly why the bootstrap token lives in a
`0600` file rather than in an environment variable — the F-005 fix from Phase 3.
