# WebUI design review — proposal v1

**Reviewed:** 2026-07-26 · **Verdict: NOT ACCEPTED. Revise and re-present.**
**Proposal reviewed:** 26 destinations in 5 categories, 9 selectable themes, persistent
privacy spine, permanent approval strip.

Recorded so the next session can act without re-deriving any of it. **No new preview was
produced in this session — the Owner asked for closure first and a fresh proposal on
reopening.**

---

## What the Owner rejected, in his words and what it means

### 1 · The right rail must be modular, not a fixed area
> "la barra a destra il *Context in this request* serve per forza un'area così? non è
> meglio quello spazio farlo modulare a finestra? che l'utente decide se trascinarla lì e
> avere la barra, o toglierla?"

v1 spent a permanent 268px column on context. The Owner wants that space to be **a
dockable panel the user controls**: draggable into the rail, or dismissed entirely, with
the centre column reclaiming the width. Not a fixed third column.

Design consequence: the shell becomes a two-column base (rail + canvas) with an
**optional** dock. Panel state must persist per user. This also frees real estate on
smaller screens, where v1 simply hid the rail at `max-width:1080px`.

### 2 · The chat surfaces are missing — there must be three, not one
> "non vedo una chat stile claude e neanche una chat per noesar coden ultra che sarebbe
> la versione tui, inoltre c'è la versione coden ultra tui?"

v1 had a single `Chat · Ask/Create/Act` entry and no real chat surface drawn at all. The
Owner points at the existing CodeN Ultra product as the reference for what he means.

**Verified read-only on disk** (the container `coden-ultra-full-product` is *exited*, so
`http://192.168.178.100:8210/` does not answer and was not started — it belongs to
another project and CLAUDE10 §5 rule 16 forbids touching it without authorisation):

```text
WEBUI/client.html      the client SPA — nav: Menu, History, Models, Documents,
                       Modules, Updates, User Guide, Profile
                       carries BOTH a plain chat view and a separate "⚡ Coden Ultra"
                       view, which since s254 posts to /coding-agent/stream — the same
                       endpoint the TUI uses, not the plain chat endpoint
BIN/coden-tui.mjs      the real terminal UI (Ink + Commander, rewritten s253),
                       with /local /lfiles /git /shell /apply /session /attach and a
                       two-pass diff viewer
```

So NOESAR Evolution needs **three distinct conversational surfaces**, not one:

| Surface | Character |
|---|---|
| **Chat** | Claude-style. Plain conversation, attachments, streaming, history. The everyday surface. |
| **CodeN Ultra chat** | Coding-agent oriented. Plans, file blocks, diffs, path authorisation, verified mutations. A different endpoint and a different mental model, not a mode toggle on the plain chat. |
| **CodeN Ultra TUI** | The terminal surface. Either embedded as a web terminal or documented as the CLI it already is. |

**Open question for the next session — ask before building:** three separate nav
destinations, or one Chat destination with three clearly-labelled surfaces inside it? The
Owner said "chat stile claude" and "chat per noesar coden ultra" as separate things, which
points at separate destinations, but this should be confirmed rather than assumed.

### 3 · The sidebar must collapse
> "la sidebar deve essere a scomparsa"

v1's rail was permanently open at 244px. It must collapse — to an icon rail or fully
away — and remember the choice.

### 4 · One Settings page, not settings scattered through the nav
> "deve avere meno impostazioni con una pagina solo per impostazioni, come cambiare
> lingua, cambiare colore (qui metterei tutti i colori proposti come multi selezione),
> licenza per attivare eventuale licenza e impostazioni di noesar evolution"

This is the sharpest correction, and **the Owner is right against the specification, not
just against taste.** `01_PRODUCT/11` requires "simple before technical, progressive
disclosure", and `DESIGN/APPROVED_WEBUI_REFERENCE.png` — which that document calls
binding — has **a single `Settings` entry** in its navigation. v1 promoted Settings,
Security, Users, Privacy, Audit, Compliance, Health, Logs, Updates and Backups to
top-level destinations: eleven of twenty-six. That is the opposite of the rule, and it is
the same mistake the deployed 21-entry interface makes, merely grouped.

Settings must therefore be **one destination with sections inside it**, carrying at
minimum:

```text
Language          the interface language
Appearance        all nine themes as a selectable set  ("tutti i colori proposti
                  come multi selezione")
Licence           activation of a licence, if one is present
NOESAR Evolution  the product's own settings
```

Everything currently in `Governance` and `System` needs re-examining against this: which
of them are genuinely destinations a person visits, and which are sections inside
Settings. That re-derivation is the main design work for v2 — it is not a cosmetic
change, it changes the whole information architecture.

---

## What survives from v1

Not everything was rejected, and these were not contested:

- **Five categories rather than a flat list** — the grouping principle stands; what
  changes is which items deserve to be destinations at all.
- **Nine selectable themes as token remaps**, with semantic colour held separate from the
  accent. The Owner explicitly wants these carried into the Settings page.
- **The persistent privacy indicator** and the **permanent approval strip**.
- The **coverage map** against the specification.

---

## For the next session

1. Re-derive the information architecture from the constraint "one Settings page,
   collapsible rail, fewer destinations". Expect the count to drop well below 26.
2. Draw the three conversational surfaces properly — they are the product's primary
   workspace and v1 did not draw any of them.
3. Make the context panel dockable and dismissible, with persisted state.
4. **Ask the open question in §2 before building.**
5. Optionally, with the Owner's authorisation, study CodeN Ultra live: it needs
   `docker start coden-ultra-full-product` — another project's container, so it is his
   call, not something to do unasked. Reading `WEBUI/client.html` and `BIN/tui/` on disk
   is read-only and needs no authorisation.
6. Present a fresh preview and iterate until accepted. The Owner has been explicit that
   more attempts are expected and welcome.
