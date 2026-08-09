# Voice — hearing and speaking, inside the installation

Owner requirement, s336: *«il voice deve fare tutto non deve essere statico … voglio voce reale
non robotica quindi fai un motore reale interno con voce naturale»*.

Three things follow from that sentence, and each is a decision this document records rather than
a detail of how it was built.

**The browser never hears.** Until s336 the product's voice was `SpeechRecognition`, which means
the audio left the installation for whoever built the browser, and whether an installation could
hear at all depended on which browser was pointed at it. Hearing and speaking are now served by
the installation, over HTTP, to a model the operator chose. `apps/webui-static/voice-control.js`
remains in the tree marked SUPERSEDED; nothing imports it.

**There is no voice vocabulary.** What is heard is resolved against the product's own entries —
the same array the `/` menu resolves typing against. So "what can I say?" has one permanent
answer: whatever you can type. A panel added to `index.html` is speakable the same afternoon,
with nothing edited anywhere.

**Voice cannot do what typing cannot.** The resolver returns a *line*, and the line goes through
the same `planTurn` a keyboard's would. A destination is opened; a capability is placed in the
composer and waits for the send click, because a microphone has no Enter key.

---

## What to configure

Five environment variables. Nothing else, and no code.

| Variable | What it is | Required |
|---|---|---|
| `NOESAR_VOICE_TRANSCRIBE_ENDPOINT` | Base URL of a server exposing `POST /v1/audio/transcriptions` | to hear |
| `NOESAR_VOICE_TRANSCRIBE_MODEL` | Model name sent with each request | recommended |
| `NOESAR_VOICE_LANGUAGE` | Language hint, e.g. `it` | optional |
| `NOESAR_VOICE_SPEAK_ENDPOINT` | Base URL of a server exposing `POST /v1/audio/speech` | to speak |
| `NOESAR_VOICE_SPEAK_MODEL` | Model name sent with each request | recommended |
| `NOESAR_VOICE_SPEAK_VOICE` | Named voice of the synthesis model | optional |

The two endpoints are **separate settings** because hearing and speaking are ordinarily two
different servers. An installation that serves both from one address writes the same value twice
— which is a fact about that installation, not something the product should assume.

Configuring one does **not** imply the other. An installation set up for dictation reports that
it can hear and cannot speak, and says so on screen, because telling an operator the product can
talk when it cannot is worse than saying nothing.

### Why the OpenAI audio shape and not something of our own

`POST /v1/audio/transcriptions` and `POST /v1/audio/speech` are what whisper.cpp's server,
faster-whisper servers and the common self-hosted synthesis servers already expose. Speaking a
shape they already speak is what keeps the s318 requirement true — the catalogue must accept
**any** model — without this product carrying a table of vendors that would be out of date the
first time someone changes models. It is the same reason `local-model-runtime.mjs` probes
`/v1/models`.

The model name is **passed through, never validated against a list**, and so is the voice name.
The list of voices belongs to whatever model the operator installed.

---

## What an unconfigured installation does

It says so. Both controls beside the composer are disabled and the line under them reads:

> no transcription model is configured, so this installation cannot hear

That sentence comes from the **server**, not from the browser's opinion about microphones, and
`GET /api/v1/voice/state` is where it comes from. This is checked in the real browser by the e2e
suite, because a control that looks available and then does nothing is indistinguishable from a
broken one.

`not-configured` and `unreachable` are kept apart for the reason `active-model.mjs` keeps them
apart: telling an operator to install something they already installed is worse than silence.

---

## Verifying it, before and after choosing a model

```sh
npm run test:voice-chain
```

`tools/acceptance/voice-chain.mjs` starts a **real** HTTP listener speaking the OpenAI audio
shape, starts the **real** control plane pointed at it, bootstraps an Owner, and drives the whole
chain: audio bytes in → multipart to the model → text out → resolved into `/memory` on the
product's own list → text in → audio bytes out. It also drives the two failures that matter — a
model server that refuses, and an empty utterance.

It is not part of `npm test`, deliberately: it spawns processes and binds ports. It **is** in
`package.json` so it cannot rot unnoticed, which is the failure `tools/acceptance/*` has had
before.

Run it against your real model server by pointing the five variables at it and running the probe
in the same environment — the assertions are about the protocol, not about the stub.

### The permissions

`GET /api/v1/voice/state` needs `model.read`. `POST /api/v1/voice/transcribe` and
`POST /api/v1/voice/speak` need `provider.use` — the permission every role holds, because voice
should be available to anyone who can hold a conversation at all. All three are CSRF-guarded and
refuse an unauthenticated caller with 401, which the probe checks **before** signing in.

---

## What it can and cannot understand

Everything the interface names, in English and in the language it is displayed in. The Italian
comes from the translation catalogue the menu already paints — there is no per-language table in
the resolver, and taking the catalogue away takes the Italian with it. That is asserted, not
claimed.

Measured over the real address space: **127 of 130** spoken names resolve to exactly one thing.
The three that do not — *Progetti*, *Agenti*, *Sessioni* — each name two genuinely different
places, and the product asks which rather than choosing.

**One stated limit.** To dictate a subject to a command you must say the command's own name —
`plan fix the login`, `search getUser`, `closure it is done`. Those names are English, and a
command's Italian exists only inside its description; a description may not be used to name a
command, because that is how "stato del motore" once assembled and ran `/closure motore`. The
alternative — a hand-written table of spoken verbs — is the drifting second list this design
exists to avoid, bought with the one failure mode that runs something nobody asked for.

Anything that names nothing is **dictation**: it goes into the composer as a message. That is not
a fallback, it is the largest case — everything the product can be asked in prose is sayable, and
nothing had to be listed for that to be true.
