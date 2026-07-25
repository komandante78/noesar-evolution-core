# TLS and Reverse Proxy

The default runtime binds to loopback or a local container network.

When HTTPS termination is configured:

```text
NOESAR_SECURE_COOKIES=true
NOESAR_ALLOWED_HOSTS=noesar.example.internal
```

The proxy must preserve the original Host value. Do not expose the foundation
runtime directly to the public Internet.
