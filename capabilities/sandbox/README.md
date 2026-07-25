# Capability Sandbox Contract

Supported future worker profiles:

- WASI restricted worker
- Linux isolated worker
- Windows AppContainer/restricted-token worker
- macOS sandboxed worker
- remote attested worker

Foundation behavior:

```text
builtin/declarative entrypoint -> allowed after policy
WASI entrypoint                -> blocked, contract only
native-worker                  -> blocked
python-worker                  -> blocked
MCP                            -> blocked until gateway and egress approval
A2A                            -> blocked until gateway and delegation approval
```

Signing proves package origin and integrity. It does not make arbitrary code safe.
