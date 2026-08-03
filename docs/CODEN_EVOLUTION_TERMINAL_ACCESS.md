# CodeN Evolution — the terminal shell: how to reach it, and what CE-021 was proved with

Phase 5 of the CodeN Evolution programme (`D-0301`). Everything below was measured against a
running product; where a number or a path appears, it was read off a live process, not
inferred from the source.

---

## 1. What "the two shells" means

One engine, two ways in:

| Shell | Transport | Code |
|---|---|---|
| Browser | `POST /api/v1/tui/command` | `src/server.mjs` |
| Terminal (TTY / SSH) | unix socket, one JSON object per line | `src/session-protocol.mjs` |

Both call the **same dispatch**, closed over the **same running instances** — not two clients
with state of their own. That is `D-0230`'s design claim, and `CE-021` is the acceptance that
makes it something other than a claim:

> **CE-021** — the two shells show the same live session, and detaching does not stop the
> work. *Acceptance: start in one shell, detach, attach from the other.*

---

## 2. Reaching the terminal shell

### 2.1 A container installation (the shipped shape)

The product does **not** run an SSH daemon, and it should not: SSH is the host's, and the
terminal shell is reached by attaching to the container the product already runs in.

```sh
ssh you@the-host
docker exec -it -u 10001 noesar-evolution node /opt/noesar/tools/tui-client.mjs
```

Measured facts behind that one line:

- the socket is at **`/run/codev-peer.sock`**, mode `srw-------`, owner `noesar` (uid 10001),
  on the `/run` **tmpfs** — so it exists only for the life of the container;
- `-u 10001` is not decoration: mode `0600` means the product's own uid is the only one that
  can open it. `docker exec` without `-u` runs as root, which also works, and is a bigger
  hammer than the job needs;
- no socket path argument is needed: the image sets `NOESAR_TUI_SOCKET_PATH=/run/codev-peer.sock`.
  Without it the client's own fallback is `<repo>/.workspace/tui.sock`, which is correct for a
  from-source install and wrong inside the image, where the repo root is `/opt/noesar`;
- sign-in is the same account and the same second factor as the WebUI. The socket authenticates
  its own session (`auth.login` then `auth.mfa`); a cookie means nothing here.

### 2.2 A from-source installation

```sh
node tools/tui-client.mjs [socketPath]
```

`socketPath` defaults to `$NOESAR_TUI_SOCKET_PATH`, then to `<repo>/.workspace/tui.sock` — the
path `NOESAR_CODEV_PEER_SOCKET_PATH` tells the server to listen on.

### 2.3 What not to do

**Do not bind-mount the socket onto the host to make SSH more convenient.** The socket is the
engine's front door with no HTTP layer in front of it: mode `0600` inside a container namespace
is what currently limits it to the product's own uid. Publishing it to a host directory makes it
reachable by anything that can read that directory, and the transport applies **no per-method
permission check** of its own (§5). If a deployment genuinely needs it, decide the permission
question first.

---

## 3. CE-021, proved

```sh
node tools/acceptance/ce-021-two-shells.mjs [port]
```

Self-contained on purpose: it starts a real server from source against a throwaway workspace,
drives the **real HTTP bridge** with a real cookie/CSRF session and the **real unix socket**
with a real MFA login, and removes everything afterwards. Detaching is done the way a shell
really dies — `socket.destroy()`, no goodbye — because `exit` would only prove that a clean
shutdown is clean.

Result on 2026-08-03, all ten checks:

```
PASS  the terminal shell starts a piece of work — 697aff0d… PENDING_APPROVAL
PASS  the browser shell sees it after the terminal is gone — 200 PENDING_APPROVAL
PASS  the browser shell finishes what the terminal started — promoted=true
PASS  a re-attached terminal sees the state the browser left — PROMOTED
PASS  one causal trail carries both shells' halves of the work
      — planned → approved → capability.minted → executor.ran → shadow.compared
        → claims_verified → promoted
PASS  the asymmetry between the shells is exactly the known one
      — socket-only: sessions.list, product.invariants, coden.addresses
PASS  the browser session really is gone before the terminal is asked — logout 200, then 401
PASS  the terminal shell sees what the browser started, after the browser session is gone
PASS  the terminal shell finishes what the browser started — promoted=true
PASS  a command whose shell died mid-flight still completed — status=PROMOTED
CE021_FAIL=0
```

The last one is the sharper half of *"detaching does not stop the work"*: a shell that writes
`workspace.approve` and is destroyed in the same tick. The answer is lost — nobody is left to
receive it — and the run is promoted anyway. It has to be asked from a different shell, which
is the only way to ask it once the asking shell is dead.

And the documented access path itself, proved on the deployment shape rather than from source:
a disposable container built from `oci/Dockerfile`, attached to with the command in §2.1, signed
in, and driven — `/coden/bench/diff`, `panel`, `/settings/sessions` all answered over the live
socket at `/run/codev-peer.sock`.

---

## 4. Two defects this phase found by measuring

**The program the interface names was not in the image.** The WebUI's CodeN Evolution TUI page
says to run `node tools/tui-client.mjs` "from a real terminal on this host (or over SSH into
it)". `oci/Dockerfile` copied only `tools/acceptance/` out of `tools/`: the socket was listening
and nothing shipped could speak to it. Fixed in the recipe, and `coden-addressable-panels.test.mjs`
now ties the page's command to the `COPY` line, so the claim cannot outlive the file again.

**Both shells displayed a run state the engine had never sent.** `workspace-actions.plan()`
returned no `status`. The browser stitched `{...planned, status:'PENDING_APPROVAL'}` onto the
answer; the terminal printed the constant `status: PENDING_APPROVAL`. Each was showing, as the
engine's word, something the engine had not said — true of every plan this build makes, which is
exactly what made it invisible. The engine now returns the stored status and both clients print
what they were told.

---

## 5. What the two shells do *not* share — disclosed, not smoothed over

**Method surface.** Five methods exist only on the socket: `sessions.list`, `sessions.get`,
`sessions.action`, `product.invariants`, `coden.addresses`. This is deliberate — the browser
reaches each through a surface of its own (its Sessions page, its Invariants panel, its address
box), so routing them through the bridge would add a second way in rather than a missing one.
`ce-021-two-shells.mjs` measures the difference live and `two-shells-parity.test.mjs` fails if a
**new** socket-only method appears without a decision.

**Permission model — was a coincidence, now a construction (`D-0302`).** As measured in phase 5,
the browser bridge looked up a permission per method and the socket transport checked
**authentication only**. It changed nothing at the time — every role that can authenticate holds
`workspace.read` and `workspace.write`, the only two permissions the table named — which is
exactly what made it invisible: **the shells agreed by coincidence, and the coincidence was one
narrowed role away from ending.**

There is now **one table**, `SESSION_METHOD_POLICY` in `session-protocol.mjs`, and it is enforced
**inside the dispatch** rather than by each transport: a shell that does not say what its caller
may do is refused, and a method with no policy entry is refused rather than run with no check at
all. The HTTP bridge derives its own exposure list from that table instead of keeping a second
one. A transport added later inherits the gate instead of inheriting the gap.

What this does **not** change: no role is locked out today, because all of them hold both
permissions — `two-shells-parity.test.mjs` measures that too, so a future narrowing shows up as a
deliberate product decision rather than as a shell that quietly stopped working.

The socket-only methods are gated at what their own browser routes already require:
`sessions.list`/`sessions.get` at `workspace.read`, `sessions.action` — which carries `purge` — at
`workspace.write`, matching `POST /api/v1/sessions/actions`.

**Scrollback.** The browser's Terminal tab keeps its own scrollback per tab, client-side. Two
tabs on the same session do not share what was typed into them, and never did. The session they
reach is shared; the transcript of the typing is not.
