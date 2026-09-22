# Effect receipts in one minute

```sh
sh examples/effect-receipt-demo/demo.sh
```

Needs Node 22 and Docker (Linux or macOS). It installs two local packages with `npm install`, each
in a throw-away copy with no network, after declaring what installing a package may touch:
`node_modules/`, `package.json`, `package-lock.json` and npm's cache.

| Package | What it does | Receipt |
|---|---|---|
| `receipt-demo-clean` | nothing but arrive | `CLEAN` |
| `receipt-demo-install-script` | its `postinstall` adds a key to `~/.ssh/authorized_keys` | `UNDECLARED_EFFECT: ~/.ssh/authorized_keys` |

Each receipt is an in-toto Statement in a DSSE envelope signed with Ed25519, and the demo verifies
it with the public key alone: the verifier recomputes the verdict instead of trusting it. Nothing
outside a temporary directory is touched, and the key in the second package is not a real key.

How it works and what it does not measure yet: [`docs/EFFECT_RECEIPTS.md`](../../docs/EFFECT_RECEIPTS.md).
