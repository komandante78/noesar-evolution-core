# SESSION HANDOFF

**Written at the close of s331 (2026-08-07).** A cold session can resume from this file alone.

---

## Where the project is, in three lines

```text
FATTO        Phase 8 delivered, DEPLOYED and made persistent (D-0340/0341/0342): the access
             gesture is one word, `CE-031` and `CE-035` are proved, and the recipe survives a
             reboot. `/skills` BUILT and DEPLOYED (D-0343) — the last named gap in the one
             menu. The 8-phase CodeN Evolution programme is complete and live.
             Repo, origin, image and served bytes all agree at `65c8a24`.

NON FATTO    An actual reboot (not this session's to perform — the boot ordering is inferred).
             Windows is UNVERIFIED (no PowerShell on this host; structural assertions only).
             `/skills` is `enforced:false`: nothing yet composes an adopted skill into a Plan.
             The `coden` account is present and INERT — no key.

PROSSIMA     Owner's. First thing to measure on opening: `docker exec noesar-evolution
             coden_evolution --help` and `curl -s -o /dev/null -w '%{http_code}'
             http://192.168.178.100:8100/api/v1/skill-catalog` — the word and the surface.
             Both work today.
```

---

## What is live right now, measured at close

| | |
|---|---|
| Image | `noesar-evolution:d0343-skills` (417 ms downtime, three sha levels identical) |
| Rollback | **one**, `noesar-evolution-old-d0340`. Images kept for every documented path |
| Health | `running healthy`, `/livez` 200, `/readyz` 200, 30 env, ip `172.22.0.5` |
| Terminal | both sockets served; `coden_evolution` reaches the live session |
| `/skills` | routes answer **401, not 404**; the section and the menu entry are in the **served** bytes |
| Host recipe | persistent via `/boot/config/noesar-evolution/`, wired into the boot script |

---

## Phase 8 — the access gesture (D-0340 · D-0341 · D-0342)

Measured before: three concepts (engine permission + container name + client path), with both
sockets `srw-------` on the container's own tmpfs. After: **one word**, and the launcher
declares which rung it used.

**The recipe was wrong in three ways, and only applying it found them.** `nologin` breaks
`ForceCommand` (sshd runs it through the login shell); the sudoers rule needs **three** fixed
argv, not one, because the launcher probes the engine and asks for a TTY only when it has one;
and a host with `AllowUsers` makes the `Match` block dead with a `Permission denied` that never
names the cause. Two missing steps added: `authorized_keys`, and reading the host's real
`Port`/`ListenAddress` (here **2223**, not 22).

**`CE-031`** — `coden`, uid 999, outside the docker group, reaches the session.
**`CE-035`** — from a separate network node with no docker socket and no host credential,
`ssh coden@192.168.178.100 -p 2223` and no other argument starts it. Declared: a separate
network node, **not** a second physical machine.

**A defect found by running it in a container rather than reading it:** through the
`/usr/local/bin` symlink, `$0` is the LINK, so the launcher looked for the client beside the
link — phase 5's failure from the opposite direction, with the suite green throughout.

**Persistence** lives OUTSIDE the repository, at `/boot/config/noesar-evolution/`, because it
is an installation acting on its own host; `08_INSTALLAZIONE.md` §12.5 states the principle and
names no host. Proved by tearing the manual state down and letting the boot script rebuild it;
idempotent across three runs; `sshd -t` with automatic restore on failure.

---

## `/skills` (D-0343)

Open since s322, re-measured absent three times. Built **surface-first** — module, schema, twin
routes, both methods bridged in the one policy table, one registry for both transports, a
section the address book **derives** (53 → 54 addresses), a loader — and the menu entry last.
The entry followed the surface; it did not summon it.

**The invariant that makes it not a second tool catalogue:** a tool *does* something, a skill
*tells the agent how*, so its payload is instructions and its danger is **context load**.
`searchCatalog()` builds its result from a named field list with **no `instructions` member**,
so a body cannot travel with a search. A projection, not a `delete` — the two differ only under
change. It reports `instructionBytes` instead.

**`CE-034` rewritten.** It asserted `/skills` is ABSENT: true when written, the wrong shape of
test from that day on — the `D-0339` failure again. Rule 3 of §4b.4 is a **biconditional**.

**A real shipped defect, repaired at the rule.** `app.js` `SETTINGS_SECTIONS` decides which
section a hash may name, and `remote-targets` (`D-0291`, s305) was never added — so that button
had a nav entry, a section and a menu row and **silently landed on Sessions**. The guards
compared the markup only against a list in the *test file*. A new guard requires the sections a
page offers and the sections the router accepts to be one set, proved by restoring the defect.
The browser probe lost its hand-edited section count for the same reason: it had already been
wrong once, unrun, for a whole phase.

---

## Verification, all produced this session

unit **1967** (1966 pass, 0 fail, 1 pre-existing skip) · ESLint **342 files, 0/0** ·
`verify-source` PASS · packaging 24/24 · cross-platform 73/73 · browser e2e **413/413** ·
shellcheck only `SC1007` on the correct `CDPATH= cd` idiom, dismissed ·
**36 mutations across two passes, each against a baseline proved green first — 35 killed**, the
one survivor unreachable by construction and documented · secret scan **6 findings, all
pre-existing** (`B-011`), zero in this session's files.

---

## The exact next actions, all the Owner's

1. **A public key** in `/boot/config/noesar-evolution/authorized_keys`, then
   `bash /boot/config/noesar-evolution/apply-coden-access.sh`. Until then the account exists
   and nobody can use it.
2. **Reboot and retry.** §12.5 says an installation is not done until it has survived one, and
   the boot ordering here is inferred rather than measured.
3. **Refresh the boot copy** of the launcher after any image upgrade that changes it. It did
   **not** change in `d0343-skills` — verified identical across repo, image and `/boot`.
4. **The named next step for `/skills`:** compose an adopted skill into a Plan before the
   Author writes. `enforced:false` says so rather than leaving it to be discovered.

**Unchanged and still open:** run files grow without bound (retention belongs with the
audit-retention decision); `state/auth.json` and `audit/events.jsonl` remain visible to the
repository scanner; `B-011` is the source of all 6 secret-scan findings, rotation deferred to
end of project by Owner instruction; Group 6 independent pentest remains the only gate holding
`productionReady:false`, and it cannot be closed by writing code.
