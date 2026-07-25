# First Owner Setup

On first start the runtime creates:

```text
/workspace/config/first-owner-setup.token
```

with mode `0600`. The token is not printed automatically.

Read it locally using:

```bash
runtime/bin/show-first-owner-token.sh
```

After successful Owner setup and TOTP confirmation, the runtime deletes the
token file and writes an audit event.

Do not send the token through email, chat, logs or support bundles.
