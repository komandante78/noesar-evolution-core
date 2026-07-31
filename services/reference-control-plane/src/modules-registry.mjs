// SPDX-License-Identifier: AGPL-3.0-or-later
//
// SUPERSEDED, D-0275 (2026-07-31): retired the day after it shipped. Owner ordered the
// real sector-modules activation framework (D-0274, `sector-modules.mjs`) built first,
// then Debug Evolution registered through THAT as a real `noesar-official` manifest — not
// kept as a parallel ad-hoc mechanism alongside it. Every import of this file and every
// route/UI surface that called it (`GET/PUT /api/v1/settings/modules[/:id]` in
// `server.mjs`, the Settings > Modules section and `#navModules` sidebar link in
// `apps/webui-static/`) has been removed. This file is left on disk, unimported, rather
// than deleted, per `CLAUDE10.md` rule 12 ("no deletion... not with rm -rf, not with git
// clean, not implicitly") — the same rule `apps/webui-react/`'s removal (`D-0195`) needed
// an explicit Owner amendment to cross. `modules-registry.test.mjs` still exercises the
// two pure functions below in isolation; they still work, they are simply unreachable
// from any live surface.
//
// External modules — optional add-ons NOESAR EVOLUTION does not own, build, or embed.
// Debug Evolution (a separate product, /mnt/cachec/DEBUG_EVOLUTION/) is the first one:
// verified live that it ships `Content-Security-Policy: frame-ancestors 'none'`, a security
// decision that belongs to that product. Embedding it in an iframe here would mean this
// codebase overriding a foreign product's own security header — a capability decision that
// is the client's to make (`CLAUDE10.md` §16/§17, Owner rule 5), not something to build by
// default. So a module surfaces as a plain external link, opened in a new tab, shown only
// when the client explicitly enables it in Settings — never auto-detected by reachability.
//
// KNOWN_MODULES is a fixed allowlist, not an open registry: the PUT endpoint configures a
// module NOESAR EVOLUTION already knows how to describe (name, default URL); it cannot be
// used to register an arbitrary new module id.

export const KNOWN_MODULES = Object.freeze([
  { id: 'debug-evolution', name: 'Debug Evolution', defaultUrl: 'http://192.168.178.100:8787' },
]);

/** Merge the persisted per-module {url,enabled} onto the known module descriptors.
 * `state.settings.modules` may be absent, or missing individual ids, on any state read
 * from before this feature existed — both cases must yield `enabled:false`, not a crash. */
export function readModulesSettings(state) {
  const stored = state?.settings?.modules ?? {};
  return KNOWN_MODULES.map((known) => {
    const saved = stored[known.id] ?? {};
    const url = typeof saved.url === 'string' && saved.url.trim() ? saved.url.trim() : known.defaultUrl;
    return { id: known.id, name: known.name, url, enabled: Boolean(saved.enabled) };
  });
}
