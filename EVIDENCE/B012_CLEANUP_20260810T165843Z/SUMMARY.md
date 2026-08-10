# B-012 cleanup — 2026-08-10

Owner authorization: "AUTORIZZO CLEANUP B-012" — resolution option 1 (prune to the single
most recent rollback), the option already named in `PROJECT_STATE.json` blocker `B-012`.

## Pre-flight (CLAUDE10.md §21e)
- Full `docker ps -a` / `images` / `network ls` / `volume ls` inventory captured to this
  directory before any removal (`pre_*.txt`).
- Confirmed all 4 removal targets were `exited`, none `running`, before touching any of
  them.

## Removed (named explicitly, one `docker rm` per container, no prune/wildcard)
- `noesar-evolution-old-d0371`
- `noesar-evolution-old-d0369-qr`
- `noesar-evolution-old-d0362-atom-warrant`
- `noesar-evolution-old-d0362-novoice` (this one and `-old-d0362-atom-warrant` were the
  identical image under two names, per the B-012 audit — both are gone now, resolving that
  duplication as a side effect)

## Kept
- `noesar-evolution` (running, live)
- `noesar-evolution-old-d0372` (the single most recent rollback, per CLAUDE10.md §21b)

## Post-flight verification
- Remaining `noesar-evolution*` containers: exactly `noesar-evolution` (running) and
  `noesar-evolution-old-d0372` (exited) — matches §21b exactly.
- `docker network ls` diff pre/post: **unchanged**.
- `docker volume ls` diff pre/post: **unchanged**.
- Non-`noesar-evolution` container count pre/post: **50 / 50, unchanged** — no other
  project's containers touched.
- Total container count: 56 -> 52 (delta 4, matches the 4 removed).
- All 5 originally-audited rollback image IDs (`83b6de3c3908`, `7ad88c3a96fc`,
  `2660a2e26ed2`, `8e6d1569dad5`, and the live `b5e043fa9029`) still present on disk —
  images were never targeted, only containers.
- Live container: same id `3575d67aac1f...`, `State.Status=running`,
  `State.Health.Status=healthy`, unchanged.
- `/livez` 200 `{"status":"alive",...}` and `/readyz` 200 `{"ready":true,...}` both before
  and after cleanup, via `docker exec noesar-evolution node -e ...` against
  `127.0.0.1:8088` inside the container (published host port is LAN-only, not loopback).
  `uptimeSeconds` increased continuously across the whole operation (46506 -> 46648,
  ~142s elapsed) — no restart occurred.

No `docker system/volume/container prune` was run. No network, volume, or image was
removed. No running container was touched. Only the 4 named, already-exited rollback
containers were removed.
