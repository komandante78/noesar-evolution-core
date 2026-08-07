# SESSION HANDOFF

**Written at the close of s331 (2026-08-07).** A cold session can resume from this file alone.

---

## Where the project is, in three lines

```text
FATTO        Phase 8 of MASTER_PROJECT/17 delivered (D-0340): the access gesture is one word.
             Measured before: three concepts (engine permission + container name + client path).
             Measured after:  `coden_evolution`, and the launcher DECLARES which rung it used.
             The 8-phase CodeN Evolution programme is complete IN THE REPOSITORY.

NON FATTO    CE-035's own verification line — a real access from a SECOND machine on the
             network — was NOT performed. It needs the §12 recipe applied to this host (a
             system user, an sshd edit): the host-level change the platform law forbids the
             product from making. It is the Owner's to run. Windows is UNVERIFIED (no
             PowerShell on this host; structural assertions only). And there is NO DEPLOY.

PROSSIMA     Owner decisions, in this order. First thing to measure when it opens: whether the
             running image carries `/opt/noesar/tools/coden-evolution`. Today it does not.
```

---

## The one thing that matters most on opening

**The launcher is in the repository and not in production.** `docker exec noesar-evolution ls
/opt/noesar/tools/coden-evolution` returns "no such file". So the one word does **not** work on
the installation the Owner actually uses until the image is rebuilt and redeployed — and a
deploy is an Owner decision, not a step of this phase.

This is the s329 lesson written down in advance: work that is not pushed and deployed does not
exist for the Owner. Here it **is** pushed; it is **not** deployed, deliberately, and that is
stated first rather than in a footnote.

---

## What phase 8 delivered, and how it was proved

Six files, +1152 lines, nothing removed from anything else:

| File | What |
|---|---|
| `tools/coden-evolution` | the launcher — POSIX `sh`, three rungs, three external dependencies (`sh`, `cat`, and `readlink` only when its own path is a link) |
| `tools/coden-evolution.ps1` | the Windows twin — **never executed**, see below |
| `MASTER_PROJECT/08_INSTALLAZIONE.md` §12 | the recipe per OS family, plus the fixed-argv sudoers rule |
| `oci/Dockerfile` | the launcher is **shipped**, `chmod 0755`, linked to `/usr/local/bin/coden_evolution` |
| `services/reference-control-plane/test/launcher-portability.test.mjs` | 33 cases — `CE-031`, `CE-032`, `CE-035` |
| `tools/verify-source.mjs` | both spellings among the required sources |

**How it finds the session** (detect at runtime, never presume — platform law):

| Rung | Wins when | Does |
|---|---|---|
| `socket` | a socket this process can already reach | runs the terminal client on it |
| `engine` | no socket, so the session is in a container | finds the engine that **answers**, finds the container by the **label** the image already carries, re-enters itself inside it |
| declaration | nothing worked | lists what was tried and what each returned, names the recipe, exits 3 |

Exit codes `2` / `3` / `4`; `4` **names** the matches rather than choosing between them.

**Verified in that session** — unit **1949** (1948 pass, 0 fail, 1 pre-existing skip); ESLint
**340 files, 0/0**; `verify-source` PASS; packaging 24/24; cross-platform 73/73;
`shellcheck` v0.10.0 from a disposable container → only `SC1007`, twice, both on the correct
`CDPATH= cd` idiom (**dismissed with reason**); **20 mutations against a baseline proved green
first, 19 killed**; secret scan **6 findings, all pre-existing** (`B-011`), **zero** in this
phase's files, checked per file.

**Proved on the real host, not simulated** — a disposable image built **from the live image**
with the two shipping lines added: `sha256` of the launcher **identical repo↔image**, the one
word resolving through the symlink, and the **real** client connecting (`protocol
noesar-tui/1`) up to the product's own sign-in prompt — which is the authorisation that "stays
inside" (`16` §4.2b). Then the host→container rung end to end, **including the ambiguity guard
firing for real** when two containers carried the label.

---

## The two findings worth carrying forward

**1. A real defect, found by running it in a container rather than by reading it.** The image
installs `/usr/local/bin/coden_evolution` as a symlink so the one word works in there too.
Resolving `$0` at face value made the launcher look for the terminal client next to the LINK
and report it missing — phase 5's unshipped-client failure, reached from the opposite
direction. **The suite was green the whole time**, because every test invoked the file directly
and none through a link. Fixed at the cause; two regression cases added.

**2. Dead code removed instead of covered.** A mutation deleting a `command -v "$0"` branch
survived. Measuring said the branch was *unreachable*, not untested: for a `#!` script the
kernel discards the caller's `argv[0]` and substitutes the exec path — confirmed against the
contrast case of a non-shebang binary, where a forced name *does* survive. The branch was
removed. A second survivor (the symlink hop limit) is kept and **recorded as unreachable**,
with a case pinning the reason, because the kernel `ELOOP`s before the launcher ever starts.

Also repaired in passing: the mutation harness now **refuses a red baseline**, after one run
reported `21/21 killed` while the suite was failing.

---

## The exact next action

Nothing is in flight. Three Owner decisions, none of which this session may take:

1. **Deploy.** Rebuild the image and redeploy so the one word works on the live installation.
   Everything the deploy needs is in `docs/INSTALLATION_LEDGER.md` under phase 8; the running
   container is `noesar-evolution:d0338-restart-durable`, the one rollback is
   `noesar-evolution-old-point4b`.
2. **The remote proof of `CE-035`** from a second machine — apply
   `MASTER_PROJECT/08_INSTALLAZIONE.md` §12 to this host. Until then `CE-031` and `CE-035` are
   proved **by construction and inside a container, not by remote access**.
3. **`/skills` still does not exist** (zero skill surfaces in
   `services/reference-control-plane/src/`, re-measured s322/s326/s328). It can be worth a
   phase on its own.

**Improvement proposal recorded and not executed** (`D-0340`): the launcher could map ssh
ACCOUNT → installation from its own invocation name, so two installations become two `ssh`
targets instead of a config file to maintain. Roughly half a phase.

**Unchanged and still open from s330:** run files grow without bound (retention belongs with
the audit-retention decision), and `state/auth.json` plus `audit/events.jsonl` remain visible
to the repository scanner. `B-011` (tokens in the `EVIDENCE/` of `D-0325`) is still the source
of all 6 secret-scan findings, rotation deferred to end of project by Owner instruction.

**Container hygiene at close:** exactly two project containers survive — `noesar-evolution`
(running, healthy) and one rollback. Volumes identical to the pre-cleanup inventory, networks
unchanged, no `prune` used. `/livez` and `/readyz` both 200 after the cleanup, and the terminal
socket still served.
