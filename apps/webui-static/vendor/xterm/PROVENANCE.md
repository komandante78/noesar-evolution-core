# `@xterm/xterm` — vendored, and where it came from

**This is the first third-party runtime dependency in this product's history.** Until
2026-08-13 every import in NOESAR EVOLUTION was `node:*`, no `node_modules` was tracked, and
even the QR encoder was hand-written (`qr.js`). `D-0404` needs a terminal emulator in a browser,
and writing one is not a smaller risk than vendoring one. **The supply-chain posture of this
product changed on the day this directory landed, and that is stated here and in
`docs/INSTALLATION_LEDGER.md` rather than left for someone to notice.**

## What is here, and what is deliberately not

| File | Bytes | SHA-256 |
|---|---|---|
| `xterm.mjs` | 344,970 | `b336ec65a086c056d4804b3d4c2347da5663d3f23c3f25be866467bd8857ad59` |
| `xterm.css` | 7,112 | `854a7c0fb70e8b1a083c16797ab827299fb18744f5ad34f227b48337e33293c6` |
| `LICENSE` | 1,261 | `b569f629d00f2626a8100df2a1798210535621e42164dfd426a6fe5aac7b0ccd` |

**Not vendored:** the package's `src/` TypeScript tree (several hundred files), the `.map` source
maps, and `README.md`. The maps would ship the whole source anyway, by another route, and §33
keeps build inputs out of the repository. What is here is what the browser loads and the licence
that governs it — nothing else.

## Provenance, verified rather than asserted

```text
package          @xterm/xterm
version          6.0.0
licence          MIT  (the `license` field AND the LICENSE file itself, both read)
registry         https://registry.npmjs.org/@xterm/xterm/-/xterm-6.0.0.tgz
dist.integrity   sha512-TQwDdQGtwwDt+2cgKDLn0IRaSxYu1tSUjgKarSDkUM0ZNiSRXFpjxEsvc/Zgc5kq5omJ+V0a8/kIM2WD3sMOYg==
tarball SHA-256  908e66e04af6c8dc6b00dd3b54de088e2e81e5ed866284fd6c2fb3c2d1c7a3f6
obtained         2026-08-13, `npm pack` inside a disposable `node:22-bookworm-slim` container
```

**The integrity was recomputed from the downloaded bytes and compared to the value the registry
publishes, and the two are identical.** That is the check being recorded — not "npm said it was
fine", which is the same party making both statements. Anyone re-deriving this can repeat it:

```sh
docker run --rm -w /out node:22-bookworm-slim sh -c \
  'npm pack @xterm/xterm@6.0.0 --silent >/dev/null 2>&1; \
   node -e "const{createHash}=require(\"node:crypto\"),{readFileSync}=require(\"node:fs\");
            console.log(createHash(\"sha512\").update(readFileSync(process.argv[1])).digest(\"base64\"))" *.tgz'
```

## Offline, and no CDN — the rule this exists to satisfy

`CLAUDE10.md` §31 makes offline operation the baseline: the core must be usable with no external
service reachable. A `<script src="https://cdn…">` would have been fewer bytes in the repository
and a network dependency in every installation, on every load, for every operator — including the
air-gapped ones this product is meant to serve. It is served from this installation's own origin,
under the same `script-src 'self'` policy as everything else.

## No font ships with it — measured, not assumed

`docs/CODEN_EVOLUTION_TERMINAL_DESIGN.md` §4.3 authorised vendoring "one Nerd Font weight as
`woff2`" alongside this. It is **not** here, and the reason is a measurement rather than a
preference: the renderer's complete non-ASCII repertoire is

```text
§ · è — … › ⋯ ⎿ ⏎ ⏺ ─ │ ╭ ╮ ╯ ╰ ▍ ▸ ◈ ○ ◐ ⚑ ⚠ ✓ ✕
```

— box drawing, geometric shapes and dingbats, all in standard Unicode blocks, and **not one
private-use codepoint**, which is the only thing a Nerd Font actually adds. A multi-megabyte
binary with a per-face licence to obtain nothing measurable is cost without benefit. The page
uses a platform monospace stack instead. Recorded as `D-0413`; reversible the day a glyph is
introduced that needs it, and the test that lists the repertoire will say so.

## Updating this

Not by editing files here. Re-run the command above at the new version, replace all three files,
update every hash in this document, re-read the LICENSE (it can change between versions), and
record the change in the ledger. `vendor-provenance.test.mjs` fails if the bytes on disk stop
matching the hashes above — which is what makes this document a check rather than a claim.
