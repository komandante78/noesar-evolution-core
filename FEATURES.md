# NOESAR EVOLUTION — Features

What the product does, in one line each. Grouped the way the WebUI itself is organized
(twelve destinations behind Home, Settings and the workbench), not by internal module name.
Every line below describes something built and tested, not a plan — see
`docs/DECISION_LOG.md` for the evidence behind any specific claim.

## Chat and multimodal input

| Feature | Description |
|---|---|
| **Multi-turn chat** | A versioned context graph, not a flat message list — fork, edit, regenerate, exclude, merge, compare and undo any part of a conversation's history. |
| **Provider-neutral models** | Local OpenAI-compatible servers by default; OpenAI, Anthropic Claude, Moonshot/Kimi or a custom OpenAI-compatible endpoint as opt-in, disabled-by-default, credential-encrypted, consent-scoped additions. |
| **Document ingestion** | PDF, Office and plain-text files are extracted into the conversation's context, with content-type sniffing that never trusts a file extension alone. |
| **Audio transcription** | Voice notes and audio attachments are transcribed through the same speech engine the live microphone uses. |
| **Vision fallback for images** | When OCR finds no text in an image, an operator-declared vision-capable provider is asked to caption it — never inferred, never guessed. |
| **Hands-free voice** | Wake-word activation and voice input/output for the chat surface. |

## Documents, code and creation

| Feature | Description |
|---|---|
| **Editable documents** | Rich-text documents, spreadsheets, charts and canvases live inside a project, not as detached file uploads. |
| **CodeN Evolution** | An AI coding agent that reads, writes and refactors this installation's own workspace through an authorised, capability-scoped execution path — never a raw shell handed to a model. |
| **Terminal (TUI)** | The same CodeN Evolution capability, reachable over SSH as a real terminal UI — one product, two surfaces, proven not to diverge. |
| **Plans, not blind edits** | Every code-changing action is planned, measured against a shadow copy of the workspace, and approved before it touches real files. |

## Agents and tools

| Feature | Description |
|---|---|
| **Agents** | Configurable AI agents with their own instructions, tool access and approval policy, running multi-step goals rather than single replies. |
| **Tool integration (MCP + HTTP)** | Local and external tools — including Model Context Protocol servers — reachable under the same consent, credential and network-egress rules as everything else. |
| **Human-in-the-loop approval** | A mutating agent step waits for an explicit approval before it runs; the approval queue and its audit trail are first-class, not a log line. |
| **Simulation before execution** | Where the reasoning backend supports it, a plan can be predicted against a shadow workspace before anything real changes. |

## Knowledge and memory

| Feature | Description |
|---|---|
| **Knowledge base** | Files, notes and structured facts a project or the whole installation can draw on, organized into four distinct memory categories rather than one undifferentiated store. |
| **Retrieval-grounded answers** | The "Ask" mode answers from retrieved sources with citations, not from an unattributed model guess. |

## Authority, security and capability control

| Feature | Description |
|---|---|
| **Capability tokens** | Every file write, command execution or network call an agent performs is backed by a signed, single-use, scope-limited token — minted by the engine, never self-granted by a plugin or adapter. |
| **Independent containment** | The token-minting engine re-derives workspace-escape and file-scope checks itself; it never trusts a plan's own declared safety flags, proven against an adversarial reasoning backend that never filters anything on its own. |
| **Sandboxed execution** | Commands an agent runs are isolated with the strongest confinement primitives the host actually offers, detected at runtime rather than presumed. |
| **SSRF and DNS-rebinding protection** | Outbound calls to providers and external tools re-resolve and pin the destination address at connection time, refusing a hostname that resolves inside the installation's own network. |
| **Role-based access and row-level security** | Every resource is scoped to who may read or write it, enforced at the database layer as well as the API. |
| **Audit ledger** | A hash-chained, tamper-evident record of authorization decisions and mutating actions. |

## Installation and operations

| Feature | Description |
|---|---|
| **Self-hosted, any platform** | No dependency on a specific host, kernel feature, or cloud provider; capability is detected and degraded gracefully, never presumed. |
| **Offline-first** | The core product starts, runs and passes its own tests with no external network reachable. External API integrations are opt-in and off by default. |
| **Owner registration, no license key** | Access control is a first-owner setup flow with MFA, not a code-based license activation layer. |
| **Update and rollback** | Signed update packages, a preserved predecessor container for every deployment, and a documented, tested rollback path. |
| **Hardware-aware model sizing** | Given the host's RAM, cores and accelerators, the installer estimates whether a given model and quantization actually fits before recommending it. |

## Governance and settings

| Feature | Description |
|---|---|
| **Owner and access management** | People, roles and sessions managed from one place, with elevation for sensitive actions time-boxed rather than standing. |
| **Health and logs** | Live service health, structured logs and the same status a person would need mid-incident, in the product itself. |
| **Storage and backups** | Workspace backups with checksums, taken with the service stopped for a consistent snapshot. |
| **Scheduled tasks and workflows** | Recurring or deferred agent work, visible from the same Home surface as active runs. |

---

*Every row above is backed by a decision entry and a test in `docs/DECISION_LOG.md` — this file
names what exists, that file proves it. Where a capability is still being built, it is not
listed here; see `docs/SESSION_HANDOFF.md` for what is currently in progress.*
