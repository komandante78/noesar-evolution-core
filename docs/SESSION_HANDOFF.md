# NOESAR EVOLUTION — Session Handoff

**Rewritten at the end of every phase. A cold session should be able to resume from this
file and `PROJECT_STATE.json` alone.**

---

## Current position

| Field | Value |
|---|---|
| Phase just completed | **4 — completion gate, then the LAN access gate** |
| Phase status | `COMPLETED_WITH_COMPLETION_GATE_AND_LAN_ACCESS_GATE` |
| **Next phase** | **5 — documentation, licensing audit, release and final packaging** |
| `NEXT_PHASE` | `5_READY` — **documentation only; see the constraint below** |
| Project root | `/mnt/cachec/NOESAR_EVOLUTION` |
| Runtime root | `/mnt/cachec/NOESAR_EVOLUTION_RUNTIME` |
| Updated (UTC) | 2026-07-25 |

**The product is installed, running, and now reachable from the local network.**
Container `noesar-evolution`, image `noesar-evolution:phase4-complete-lan`, published on
`192.168.178.100:8100`, healthy — with PostgreSQL 18.4 and pgvector 0.8.5 inside it, and
still **un-bootstrapped by design**.

# ➜ http://192.168.178.100:8100

No PowerShell. No SSH tunnel. No port forwarding. Open it in a browser on any machine on
the local network.

### The constraint on Phase 5

```text
PHASE_4_TECHNICAL_GATE          PASS
LAN_WEBUI_SERVER_BIND           PASS
CLIENT_BROWSER_TEST             AWAITING_OWNER
OWNER_BOOTSTRAP                 AWAITING_OWNER_INTERACTION
PHASE_5_DOCUMENTATION_READY     true
PHASE_5_FINAL_PACKAGING_READY   false
PRODUCTION_READY                false
```

Phase 5 may begin **for documentation, licensing audit and preparation only**. It may
**not** declare the installation complete and may **not** package the release until all
five of these are `PASS`, and all five are things only the Owner can do:

```text
CLIENT_BROWSER_TEST      OWNER_BOOTSTRAP      MFA_TOTP
TOKEN_REUSE_REJECTED     STEP_UP_AUTH
```

---

## What the LAN access gate did

Made the WebUI reachable from a browser on the local network, without weakening
anything — and found that doing so quietly broke one security assumption.

```text
before   noesar-evolution:phase4-complete       127.0.0.1:8100->8088
after    noesar-evolution:phase4-complete-lan   192.168.178.100:8100->8088
```

```text
unit tests               455/455    (444 before)
installer hardening      100/100    (48 before)
eslint                   137 files, 0 errors, 0 warnings, 0 no-undef
shellcheck / semgrep / detect-secrets    clean on the changed surface
backup                   1886/1886 verified, byte-identical to the live runtime
findings                 7 raised: 3 medium, 3 low, 1 informational — 6 closed
```

### The one that mattered

**`/metrics` was readable without a session, and LAN access would have handed it to the
whole subnet.** The gate was `if (!isInternalAddress(clientIp(req)))`, justified by a
comment saying the container publishes on loopback only. That was true, and it was
load-bearing — and the trap is subtler than it looks: **behind a published Docker port
every external caller arrives from the bridge gateway, which is itself an RFC1918
address**, so the predicate could never tell a LAN browser from a host-local process. It
was right only because, on a loopback publish, nothing else can reach the port at all.

Found by *executing* the product on the new bind — `200`, 28 series — not by reading the
diff. Now `401` unless the exposure scope is `loopback`. Loopback installations are
unchanged, which the tests assert positively.

### Also found

* **A LAN publish would have answered `421` to every browser request** — the Host
  allowlist is baked as `localhost,127.0.0.1,::1`. Verified live *before* changing
  anything. Publish and allowlist are now driven from one setting so they cannot drift.
* **The installers' readiness loop always probed `127.0.0.1`**, so a LAN install would
  have printed `INSTALLATION_STARTUP=FAIL` for a container that was healthy.
* **`deployment/docker/run.sh` hardcoded the publish address** — no supported way to
  reach it from another machine at all.
* **`PROJECT_STATE.json` recorded an image ID the installation was not running.** It
  said `ec2ac8bd`; the tag had been moved to `52987fbb` a minute before the container was
  created. Corrected.
* **The wrong setup-token fingerprint `af6f7ca93c31` still survived in two documents**
  after `F4C-014` was closed. Corrected; it now appears only where it is being corrected.

Full register: `docs/OPEN_FINDINGS.tsv`. Narrative and dismissals:
`docs/REMEDIATION_LOG.md`. Everything else: `docs/PHASE_4_LAN_ACCESS_REPORT.md` and
`docs/LAN_ACCESS_CONFIGURATION.md`.

---

## What was verified, and where

| Claim | Evidence |
|---|---|
| Published on the LAN address, and only there | `docker port`; `127.0.0.1:8100` now refuses — the publish moved, it was not duplicated |
| Health and WebUI over the LAN address | `/livez` `/readyz` `/healthz` `/` all `200`; 17 components, 0 degraded |
| `/metrics` no longer public | `401` unauthenticated, from the LAN address; `/diagnostics` still `401` |
| Host allowlist | declared address `200`; `192.168.178.101` and `attacker.example` both `421` |
| No CORS | no `Access-Control-Allow-Origin` on any route, with an `Origin` header present |
| Hardening unchanged | from **inside** the container: uid `10001`, `CapEff 0`, `Seccomp 2`, rootfs read-only, `/tmp` exec denied, no Docker socket, 1 mount, `pids.max 512` |
| Data intact | migrations 16/16, RLS forced on 15 tables, `noesar_app` no BYPASSRLS, no TCP listener, audit chain 11 records 0 broken links |
| Persistence | token fingerprint, state digest and audit records identical across two restarts; `RestartCount=0` |
| Nothing else touched | `network ls` and `volume ls` **identical**; 37 unrelated containers same set, none started |

---

## What was NOT done — do not assume otherwise

- **No Owner account exists.** Deliberate. See the next section.
- **The client-side browser test is not claimed.** `curl` from the server proves the port
  is bound and the app answers. It does not prove a browser on another machine can open
  it — that depends on the Owner's own machine. `CLIENT_BROWSER_TEST=AWAITING_OWNER`.
- **No TLS.** LAN traffic is plaintext, including the password and TOTP code on first
  login. Acceptable on a trusted network; required before anything wider.
- **Nothing was exposed to the internet.** No router change, no UPnP, no port forwarding,
  no VPS access. The installers cannot do any of it.
- **No independent penetration test.** Same party wrote the code, the tests and the
  reports.
- **No Phase 5 work**: no release documentation, no licensing decisions, no packaging.
- **No push** — there is no remote (`B-001`).
- `noesar-debuglab` was started for HUNT AND FIX and **stopped in the same phase**.

### One declared deviation

The gate said "use the same image". The `/metrics` fix is source-only and the container
runs the code baked into its image, so it could not be deployed without a new one —
confirmed, not assumed: `/metrics` still answered `200` after the first recreation. The
alternatives were put to the Owner, who chose the rebuild. It is an **offline two-file
overlay** (`--network=none --pull=false`) on the audited image, so no `apt` step re-ran
and the OS package set is inherited unchanged. See `D-0053`.

---

## The one thing waiting for the Owner

1. **Read the token** on the Unraid host:
   ```bash
   cat /mnt/cachec/NOESAR_EVOLUTION_RUNTIME/config/first-owner-setup.token
   ```
2. **Open `http://192.168.178.100:8100`** in a browser on the local network.
3. Choose **Create Owner account**, enter the token, pick a username and password.
4. Configure **TOTP**, save the **recovery codes** privately.
5. Complete the **first login**, then a **step-up authentication**.
6. Confirm the token is **not reusable** — a second setup must be refused.

Full procedure: `docs/OWNER_BOOTSTRAP.md`. Choose the password yourself; keep the TOTP
seed and recovery codes in a password manager. None of it should reach this repository,
a log, or a chat transcript.

**Token status, verified in this gate after the recreation and a restart:**

```text
fingerprint   db1cf03ef221   (file on disk and live container log agree)
mode          0600           owner  10001:10001
age           7.9 h of 72    expires 2026-07-28T07:34:24Z
rotated       no — it has not expired, so it was left alone
used          no             auth/status: initialized false
```

> **Verify the fingerprint against the live log, never against a document** — including
> this one. The token rotates on expiry, so any written value goes stale by design:
> ```bash
> docker logs noesar-evolution 2>&1 | grep setup-token.available | tail -1
> ```
> The previous handoff's `af6f7ca93c31` was wrong and never matched this installation
> (`F4C-014`); two documents that still carried it were corrected here (`F4L-006`).

---

## Open blockers

### B-001 — no GitHub remote · medium · unchanged
`gh` is not installed and no token is set. `GIT_PUSH=BLOCKED_NO_REMOTE`. The local
repository is complete and committed. Resolve with `gh repo create NOESAR-EVOLUTION
--private --source . --remote origin --push`, or by creating the private repository
manually and adding `origin`. **Must be private.**

### B-002 — secret scan is heuristic · low · unchanged
Neither `gitleaks` nor `trufflehog` is installed, and CLAUDE10 rule 45 forbids installing
tooling. ESLint, shellcheck, semgrep and detect-secrets cover what they cover; the
credential scan over the staged set remains heuristic and is declared as such.

### B-005, B-006 — **CLOSED** in the completion gate.

---

## Exact next action

**Do not start Phase 5 without explicit authorisation.** When it is authorised — and
remembering it may produce only *preliminary* documentation until the Owner has
bootstrapped:

1. Read `PROJECT_STATE.json`, this file, `docs/PHASE_PLAN.md`,
   `docs/INSTALLATION_LEDGER.md`, `docs/DECISION_LOG.md` — in that order.
2. The licensing backlog inherited from Phase 1 is Phase 5's largest item: **12 Rust
   crates and 2 Node packages declare no licence, there is no root `LICENSE`, and 86
   sources have no SPDX header.** The three-way split (AGPL core / Apache-2.0 SDK /
   CC-BY-SA-4.0 docs) is still a **proposal**, not a decision.
3. `docs/SBOM_REPORT.md` records a related gap: the source scan surfaces **0 declared
   licences** for the Rust tree, so licence conclusions there still need doing by hand.
4. Phase 5 packaging should rebuild from `oci/Dockerfile` with a recorded network step
   rather than inheriting the overlay chain, which is now five images deep
   (`D-0033`, `D-0053`).
5. Enable the pre-commit gate in any fresh clone: `git config core.hooksPath .githooks`.

## Reproducing this gate's verification

```bash
npm test                                    # 455 unit tests
npm run lint                                # eslint, 137 files
npm run lint:self-test                      # prove the detector fires
node tools/test-installer-hardening.mjs     # 100 checks, incl. the access-mode matrix

curl -i http://192.168.178.100:8100/livez     # 200
curl -i http://192.168.178.100:8100/metrics   # 401 — the LAN scope gate
docker port noesar-evolution
docker logs noesar-evolution 2>&1 | grep runtime.started   # exposure_scope=lan
```

## Rollback

`$ARTIFACT_ROOT/backups/phase_4_lan_access_20260725T151501Z/ROLLBACK.md` holds the exact
recreation command for the loopback configuration. The previous container is preserved
stopped as `noesar-evolution.rollback-lan-phase4complete-20260725T153133Z`, alongside the
`:phase4` and `:phase3` parachutes.
