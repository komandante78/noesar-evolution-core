# Installing NOESAR Evolution

Every command on this page was run on 2026-09-18 against release `0.1.0`, except the macOS ones,
which **nobody has ever executed** — that is said again where it matters rather than buried here.

`0.1.0` is a pre-release. Expect to find defects; [finding one is the point](#if-something-goes-wrong).

---

## Before you start

**You need Node.js 22 or newer**, or Docker/Podman if you take the container path. The installers
check and refuse rather than installing anything for you: no package manager is invoked, nothing
is added to your PATH that is not listed below, and no service is registered to start at boot.

Every installer prints `INSTALLATION/WELCOME.txt` first — five points that take a minute to read —
and writes whether a person acknowledged them into `<workspace>/config/install-consent.json`. On a
machine with no terminal to ask on, the notices are printed and the record says, in words, that
nobody acknowledged them. To accept them without a prompt:

```bash
NOESAR_ACCEPT_NOTICES=true sh deployment/linux/install-portable.sh
```

## Which path is yours

| You run | Command | What you get |
|---|---|---|
| Docker | `bash deployment/docker/build.sh` then `bash deployment/docker/run.sh` | one image, one container |
| Podman | `bash deployment/podman/build.sh` then `bash deployment/podman/run.sh` | the same, rootless |
| Unraid | `./INSTALLATION/install-unraid.sh` | one external image and container |
| Linux, from source | `sh deployment/linux/install-portable.sh` | two commands on your PATH |
| macOS, from source | `sh deployment/macos/install-portable.sh` | a start script in the destination — **never executed by anyone** |
| Windows, from source | `deployment\windows\Install-Noesar.cmd` | a launcher in `%LOCALAPPDATA%` |

All of them serve **port 8088** and bind **loopback only** by default: the product is reachable
from the machine it runs on and from nowhere else until you say otherwise.

---

## Docker, or Podman

```bash
git clone https://github.com/komandante78/noesar-evolution-core.git
cd noesar-evolution-core
bash deployment/docker/build.sh
bash deployment/docker/run.sh
```

`run.sh` refuses to start if the image is not on the machine, and tells you to build it. It reads
these, all optional:

| Variable | Default | What it changes |
|---|---|---|
| `NOESAR_PORT` | `8088` | the published port |
| `NOESAR_WORKSPACE` | `$PWD/noesar-workspace` | where your data lives |
| `NOESAR_CONTAINER` | `noesar-evolution` | the container name |
| `NOESAR_MEMORY_LIMIT` | `8g` | memory ceiling |
| `NOESAR_CPU_LIMIT` | `4` | CPU ceiling |
| `NOESAR_ALLOWED_HOSTS` | loopback names | which `Host:` headers are accepted |

Podman is the same two scripts under `deployment/podman/`.

## Unraid

Run as root, from the repository directory:

```bash
./INSTALLATION/install-unraid.sh
./INSTALLATION/verify-installation.sh
```

It builds one external Docker image and starts one external container. It does not delete existing
containers, and it preserves the workspace when you uninstall.

## Linux, from source

```bash
sh deployment/linux/install-portable.sh
```

Optional first argument: the destination, `$HOME/.local/share/noesar-evolution` by default. It
writes two commands into `$XDG_BIN_HOME` (or `~/.local/bin`) and nothing else:

```bash
noesar-evolution     # starts the server
coden_evolution      # opens the terminal session
```

Your data stays in `<destination>/workspace`.

## macOS, from source

> **Nobody has ever run this.** The script is carried in the repository and checked statically on
> every change, which is not the same as proven. If you run it, you are the first — and an
> [issue](#if-something-goes-wrong) about it is welcome whichever way it goes.

```bash
sh deployment/macos/install-portable.sh
```

Destination by default: `~/Library/Application Support/NOESAR Evolution`. It writes
`portable-start.sh` (starts the server) and `coden_evolution` (the terminal session) there, and
does not touch your PATH.

## Windows, from source

PowerShell blocks unsigned `.ps1` files by default, which is what the `.cmd` is for:

```
deployment\windows\Install-Noesar.cmd
```

Optional: `-Destination D:\wherever`. Then start it with the launcher **inside the installation
directory**:

```
%LOCALAPPDATA%\NOESAR-Evolution\Start-Noesar.ps1
```

Its `-Port` defaults to 8088. Your data stays in `<destination>\workspace`. The terminal session is
`coden_evolution.ps1`, next to it.

---

## Did it really work?

A server that starts is not an installation that worked. These are the four answers that prove it,
on the port you installed it on:

```bash
curl -s http://127.0.0.1:8088/livez               # {"status":"alive", ...}
curl -s http://127.0.0.1:8088/readyz              # {"ready":true, ...}
curl -s http://127.0.0.1:8088/api/v1/auth/status  # {"initialized":true, ...}
```

Then open `http://127.0.0.1:8088/` in a browser.

## Signing in the first time

```
username  root
password  noesar
```

**That password is the same on every installation of this product in the world.** Change it at the
first sign-in; a banner stays across the top of every page until you do. The product enforces this
itself — no installer has to remember to.

## Where your things are

Everything you create — conversations, documents, the audit ledger, keys, the model files you
download — lives in one directory, the workspace, named per platform above. Back that up and you
have backed up your installation. Nothing is written outside it except the program tree and, on
Linux, the two commands on your PATH.

## Uninstalling

| Platform | How | Honest note |
|---|---|---|
| Docker / Podman | `docker rm -f noesar-evolution` and `docker image rm` | the workspace is yours, on your disk, and is not touched |
| Unraid | `./INSTALLATION/uninstall-unraid.sh` | preserves the workspace |
| Linux | `sh deployment/linux/uninstall-portable.sh` | removes the two commands and prints where the program tree and your data remain — it deletes neither |
| macOS | — | **no uninstaller exists.** Delete the destination directory |
| Windows | — | `Uninstall-Noesar.ps1` is three lines and **removes nothing**. Delete the installation directory yourself |

## If something goes wrong

- **It is broken** → [report a defect](https://github.com/komandante78/noesar-evolution-core/issues/new?template=bug_report.yml).
  Bring the version, the platform, and which installer you actually ran: those three decide which
  half of the product the defect is in.
- **It should be different** → [say so](https://github.com/komandante78/noesar-evolution-core/issues/new?template=idea.yml).
  "This was confusing" is a real report: a screen that needs explaining is a defect in the screen.
- **It is a security vulnerability** → never in a public issue while it is unfixed.
  [`SECURITY.md`](../SECURITY.md) says where it goes.

Known limits of this release, named rather than left to be discovered, are in
[`CHANGELOG.md`](../CHANGELOG.md).
