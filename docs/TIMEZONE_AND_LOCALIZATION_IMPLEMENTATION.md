# Timezone and Localization — Implementation

Implements `TIMEZONE_AND_LOCALIZATION_DESIGN.md`. Module:
`services/reference-control-plane/src/timezone.mjs`. 29 tests.

## Resolution chain

| Tier | Source | Implementation |
|---|---|---|
| 1 | manual user override | per user, persisted server-side in `state.json` |
| 2 | browser IANA zone | recorded at login as a **suggestion**, never applied silently |
| 3 | host operating system | `/etc/localtime` **symlink target**, then `realpath`, then `/etc/timezone` |
| 4 | installer `TZ` | `TZ` environment variable passed at `docker run` |
| 5 | UTC | last resort, always with a visible warning |

The first tier that yields a **valid IANA zone** wins. An invalid value at any tier does
not silently disappear: it falls through and is reported in `rejected`.

### Unraid: read the symlink, not the file

`/etc/timezone` does not exist on Unraid. `/etc/localtime` is a symlink into the zoneinfo
tree. An implementation reading only `/etc/timezone` would fall through to tier 4 or 5 on
this host. Verified against the real host: the symlink resolves and the zone is valid.

### Containers: tier 3 is the *image*, not the host

Found by running the installed container, not by reading code. On first boot the runtime
reported `timezone=Etc/UTC, source_tier=3` despite `TZ=Europe/Berlin` being passed —
because `/etc/localtime` **inside** a container describes the base image, and
`node:22-bookworm-slim` is `Etc/UTC`. Tier 3 was therefore shadowing the operator's
explicit setting with an image default.

**Resolution:** when `/.dockerenv` is present, tier 3 is unavailable
(`via: "unavailable-in-container"`) unless the host zoneinfo was deliberately exposed via
`NOESAR_HOST_LOCALTIME`. The documented tier order is unchanged; what changed is that
tier 3 now reports honestly that it cannot see the host.

Observed after the fix, live:

```json
{"effective":"Europe/Berlin","sourceTier":4,"source":"installer-tz",
 "hostSource":"unavailable-in-container","installerTimezone":"Europe/Berlin",
 "offsetMinutes":120,"geolocation":"never-used",
 "utcNow":"2026-07-25T07:39:32.116Z","sample":"07/25/2026, 09:39:32 GMT+2"}
```

## Storage versus display

**Every stored timestamp is UTC, ISO-8601, explicit `Z`.** Conversion happens at render
time only. No offset and no abbreviation is ever stored as the authoritative value —
`Europe/Berlin` is `+01:00` in January and `+02:00` in July, so an offset is not a
timezone.

Tested: an instant supplied as `2026-07-25T08:05:00+02:00` is stored as
`2026-07-25T06:05:00.000Z` and renders back as `08:05:00` in `Europe/Berlin`.

## Daylight saving

Resolved from the IANA database via `Intl`, never by arithmetic. Both awkward cases are
tested rather than assumed:

- **the skipped hour** — 2026-03-29 in `Europe/Berlin`: 00:30 UTC renders 01:30 (+60),
  01:30 UTC renders 03:30 (+120); local 02:30 never occurs;
- **the duplicated hour** — 2026-10-25: 00:30 UTC and 01:30 UTC both render **02:30**,
  at +120 and +60 respectively, while remaining distinct stored instants.

## Browser versus server

The browser zone is recorded as a suggestion. If it differs from the effective zone the
API returns `mismatch: true` alongside `browserReported`, so the UI can offer the choice.
It is never switched silently — a user reading audit timestamps in an unexpected zone is
a correctness problem, not a cosmetic one.

## Language

`Accept-Language` is negotiated against the supported set (`en`, `it`), honouring `q`
values, falling back to the base tag and then to `en`. A manual per-user override always
wins. Language and timezone are independent: an English UI with `Europe/Rome` times is a
tested, valid combination.

Logs, audit records and API payloads stay English regardless of UI locale.

## No geolocation

Timezone is never inferred from an IP address or from GPS. This is enforced by a test
that scans the module for positioning APIs, IP-geolocation vendors and every network
primitive (`fetch`, `node:http`, `node:https`, `node:net`, `node:dns`) — the module
imports none of them. The API also states `geolocation: "never-used"` in its response.

## Audit

Any change to an effective zone or locale writes a ledger entry carrying actor, old zone,
new zone, **source tier** and a UTC timestamp. Server default and per-user override are
recorded separately.

## API

```text
GET /api/v1/settings/timezone[?browserTimezone=Europe/Rome]
PUT /api/v1/settings/timezone   {"timezone":"Europe/Rome"}          per user
PUT /api/v1/settings/timezone   {"scope":"server","timezone":"…"}   owner only
GET /api/v1/settings/locale
PUT /api/v1/settings/locale     {"locale":"it"}
```

An unknown zone is rejected with 400 and the effective zone is unchanged.

## Not done

The WebUI settings pane (searchable zone picker, the mismatch notice, a single shared
formatter) is **not** implemented in this phase. The server-side contract it needs exists
and is tested; the front-end work is recorded for a later phase.
