# Timezone and Localization Design

**Current state: the product has no timezone handling at all.** A search across
`services/`, `ai-workspace/` and `apps/` for `timezone`, `IANA`, `Intl.` or `tz`
returns **zero matches**. Localization exists but is minimal: `apps/webui-static/i18n.js`
carries `en` and `it`.

Everything below is therefore **design**, not description.

---

## 1. Resolution chain

Resolved in this order; the first source that yields a valid IANA zone wins.

| Tier | Source | How | Persisted |
|---|---|---|---|
| 1 | **Manual user override** | user picks a zone in Settings | per user, server-side |
| 2 | **Browser IANA timezone** | `Intl.DateTimeFormat().resolvedOptions().timeZone` sent at login | per session, offered as a suggestion |
| 3 | **Host OS timezone** | container reads `/etc/localtime` symlink target | server default |
| 4 | **Installer `TZ` setting** | `TZ` env var passed at `docker run` | server default |
| 5 | **UTC fallback** | last resort | with a visible warning |

**Host reality check.** On this host tier 3 resolves to `Europe/Berlin`
(`/etc/localtime → /usr/share/zoneinfo/Europe/Berlin`), `ntpd` is running, and
`/etc/timezone` is **absent** — so the implementation must read the **symlink target**,
not that file, or it will fall through to tier 4/5 on Unraid. Tier 4 is set explicitly
in the install design (`TZ=Europe/Berlin`), so tiers 3 and 4 agree and tier 5 should
never trigger here.

## 2. Storage vs display — the non-negotiable rule

- **Every stored timestamp is UTC**, ISO-8601 with explicit `Z`: audit ledger, logs,
  ledger entries, session expiry, update metadata, backups, filenames.
- **Timezone is a presentation concern only.** Conversion happens at render time, never
  on write.
- Never store a local time, a UTC offset, or an abbreviation (`CEST`) as the
  authoritative value. Offsets are not stable — `Europe/Berlin` is `+01:00` in January
  and `+02:00` in July.

This matters concretely: the host is currently at UTC+2. A record written at
`08:05 CEST` must be stored as `06:05:00Z`.

## 3. Daylight saving

Handled by the IANA database, never by arithmetic. Store the **zone name**, and let
`Intl`/`zoneinfo` resolve the offset at render time for that instant. The container
inherits `tzdata` from `node:22-bookworm-slim`; tzdata staleness becomes an update
concern (a new tzdata release is a legitimate reason to rebuild).

Two cases that must be tested rather than assumed:
- the DST transition itself (a local time that occurs twice, and one that never occurs);
- a report spanning a transition, where two rows an hour apart may render the same wall clock.

## 4. Language

| Aspect | Design |
|---|---|
| Detection | `Accept-Language` header → best match among supported locales |
| Manual override | Settings, persisted per user; always wins |
| Supported now | `en`, `it` (existing `i18n.js`) |
| Fallback | `en` |
| Separation | UI strings only; **logs, audit records and API payloads stay English** |

Language and timezone are **independent**: an English UI with `Europe/Rome` times is a
valid, expected combination.

## 5. Browser vs server comparison

At login the client reports its IANA zone. If it differs from the server default, the
UI shows a non-blocking notice:

> Times are shown in `Europe/Berlin` (server). Your browser reports `Europe/Rome`.
> [Use browser timezone] [Keep server timezone]

Never switch silently — a user reading timestamps in an unexpected zone is a
correctness problem, especially for audit review.

## 6. No geolocation

Timezone is **never** inferred from IP address or GPS. The chain above is sufficient,
and IP geolocation is both an accuracy problem (VPNs) and a privacy problem. This is a
hard requirement, not a preference.

## 7. Ledger

Any change to the effective timezone is recorded in the audit ledger:
`actor`, `old_zone`, `new_zone`, `source_tier` (1–5), `utc_timestamp`. Both the
server default and per-user overrides are recorded — a shift in how timestamps render
must be explainable afterwards.

## 8. Files, APIs, UI and tests to build

### New / changed files

| Path | Purpose |
|---|---|
| `services/reference-control-plane/src/timezone.mjs` | **new** — resolution chain, zone validation, UTC helpers |
| `services/reference-control-plane/src/server.mjs` | wire the endpoints below |
| `services/reference-control-plane/src/auth.mjs` | accept the browser zone at login; persist the per-user override |
| `apps/webui-static/i18n.js` | locale detection + override; extend beyond `en`/`it` when needed |
| `apps/webui-static/app.js` | render all timestamps through one formatter; the mismatch notice |

### API

```text
GET   /api/v1/settings/timezone     -> { effective, source_tier, server_default, browser_reported, utc_now }
PUT   /api/v1/settings/timezone     -> { timezone }   validates against the IANA set; audited
GET   /api/v1/settings/locale       -> { effective, supported[], source }
PUT   /api/v1/settings/locale       -> { locale }     audited
```

### UI

Settings pane with zone picker (searchable IANA list) and language selector; the
login-time mismatch notice; a single shared formatter so no component renders a raw
timestamp.

### Tests

| Test | Asserts |
|---|---|
| chain precedence | tiers 1→5 resolve in order; each tier can be forced in isolation |
| Unraid host read | zone comes from the `/etc/localtime` symlink when `/etc/timezone` is absent |
| UTC storage | a record created at a known instant is stored with `Z` and no offset |
| DST | the duplicated and the skipped local hour both render correctly |
| invalid zone | `PUT` with `Not/AZone` is rejected, effective zone unchanged |
| fallback warning | with every tier unavailable, UTC is used **and** the warning surfaces |
| audit | changing the zone writes a ledger entry with the source tier |
| no geolocation | no code path performs an IP or GPS lookup for time purposes |
| locale independence | `en` UI + `Europe/Rome` works |

## 9. Phase placement

Implementation is **Phase 3** work; the tests above are **Phase 4** acceptance. None of
it blocks installation: with no timezone code at all, the product currently renders
whatever the runtime default is, which for the planned container (`TZ=Europe/Berlin`)
matches the host. The design exists so that behaviour is deliberate rather than accidental.
